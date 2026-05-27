import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { logger } from "./logger.js";
import { supabaseAdmin } from "./supabase.js";

const BUCKET = "kyc-docs";

export type KycSide = "front" | "back" | "photo";

// Strict whitelist. SVG is blocked explicitly because it can carry JS; PDFs
// are blocked because guests upload via the same flow and a PDF here is
// almost always a misuse (and harder to scan than an image).
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

// Image dimension caps. Anything bigger is downscaled before storing —
// nothing legitimate needs a 12-megapixel ID photo and oversized images
// chew through Supabase storage + Puppeteer memory.
const MAX_DIMENSION = 2400;
const OUTPUT_QUALITY = 85;

// Quick magic-byte sniff so a renamed `.jpg.exe` or an HTML file pretending
// to be image/jpeg via header tampering is rejected before reaching Sharp.
function sniffImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length < 12) return null;
  // JPEG: starts FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "png";
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "webp";
  return null;
}

export function validateKycFile(file: { mimetype: string; size: number }): string | null {
  if (!ALLOWED_MIME.has(file.mimetype)) return "File must be JPEG, PNG, or WEBP";
  if (file.size > MAX_BYTES) return "File must be under 8 MB";
  return null;
}

// Re-encodes the uploaded image with Sharp:
//   * confirms the actual file matches what the multipart claimed (defends
//     against header lies / polyglot files)
//   * strips ALL metadata (EXIF GPS, camera serial, comments, color profiles)
//   * caps dimensions so we don't store a 50 MP camera shot
//   * writes JPEG at quality 85 — small, fast to ship over WhatsApp
// Returns the sanitized JPEG bytes plus the new mimetype.
async function sanitizeImage(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    throw new Error("File does not look like a valid image");
  }
  // Cross-check header vs magic bytes. Mild discrepancy (jpg/jpeg) is fine.
  const headerType = mimetype.replace("image/", "").toLowerCase();
  if (headerType !== sniffed && !(headerType === "jpg" && sniffed === "jpeg")) {
    throw new Error(
      `File header says ${headerType} but content is ${sniffed}; refusing upload`,
    );
  }

  const out = await sharp(buffer, { failOn: "warning" })
    .rotate() // honor EXIF orientation before stripping
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toFormat("jpeg", { quality: OUTPUT_QUALITY, mozjpeg: true })
    // withMetadata is NOT called → metadata is stripped by default. Spelling
    // this out so a future reader doesn't "fix" it.
    .toBuffer();
  return { buffer: out, mimetype: "image/jpeg" };
}

export async function uploadKycPhoto(
  guestId: string,
  side: KycSide,
  file: { buffer: Buffer; mimetype: string },
): Promise<string> {
  // Sanitize first — caller already validated MIME + size, but this is the
  // last line of defense.
  let safe: { buffer: Buffer; mimetype: string };
  try {
    safe = await sanitizeImage(file.buffer, file.mimetype);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, guestId, side },
      "KYC image sanitization rejected upload",
    );
    throw new Error(
      err instanceof Error ? err.message : "Could not process the uploaded image",
    );
  }

  // Random filename. Previously `side-${Date.now()}.ext` was guessable from
  // the guest ID + upload time. We now use a 16-byte hex token so even a
  // signed-URL leak doesn't help an attacker enumerate other KYC files.
  const token = randomBytes(16).toString("hex");
  const path = `${guestId}/${side}-${token}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, safe.buffer, {
      contentType: safe.mimetype,
      upsert: true,
      // Force a sane Cache-Control even for "private" buckets — signed URLs
      // are short-lived but downstream CDNs shouldn't keep these forever.
      cacheControl: "private, max-age=0, no-store",
    });
  if (error) throw new Error(`KYC upload failed: ${error.message}`);
  return path;
}

export async function signedKycUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteKycFile(path: string): Promise<void> {
  if (!path) return;
  await supabaseAdmin.storage.from(BUCKET).remove([path]);
}

// ============ DOCUMENT LINKS (invoices, receipts, slips) ============
// Public bucket so the link works in WhatsApp without auth.
const DOCS_BUCKET = "documents";
let docsBucketEnsured = false;

async function ensureDocsBucket() {
  if (docsBucketEnsured) return;
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) {
    logger.warn({ err: listErr.message }, "storage listBuckets failed");
    return;
  }
  if (!buckets?.some((b) => b.name === DOCS_BUCKET)) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(DOCS_BUCKET, {
      public: true,
    });
    if (createErr) {
      logger.warn({ err: createErr.message }, "storage createBucket failed");
      return;
    }
    logger.info("created documents bucket");
  }
  docsBucketEnsured = true;
}

// Bucket is public so the link works in WhatsApp without auth, but invoice/receipt
// numbers are sequential and would be guessable. Suffix every uploaded path with
// a random token so paths are unguessable in practice.
function withRandomSuffix(pathInBucket: string): string {
  const token = randomBytes(8).toString("hex");
  const dot = pathInBucket.lastIndexOf(".");
  if (dot < 0) return `${pathInBucket}-${token}`;
  return `${pathInBucket.slice(0, dot)}-${token}${pathInBucket.slice(dot)}`;
}

export async function uploadPublicPdf(
  pathInBucket: string,
  pdf: Buffer,
): Promise<string | null> {
  return uploadPublicFile(pathInBucket, pdf, "application/pdf");
}

// Generic public-bucket uploader. Used for invoice/receipt PDFs as well
// as room gallery images (Phase 1 amenities work). Same bucket, same
// public-URL pattern — the caller decides the content type.
export async function uploadPublicFile(
  pathInBucket: string,
  body: Buffer,
  contentType: string,
): Promise<string | null> {
  try {
    await ensureDocsBucket();
    const obfuscatedPath = withRandomSuffix(pathInBucket);
    const { error } = await supabaseAdmin.storage
      .from(DOCS_BUCKET)
      .upload(obfuscatedPath, body, { contentType, upsert: true });
    if (error) {
      logger.warn({ err: error.message, path: obfuscatedPath }, "public upload failed");
      return null;
    }
    const { data } = supabaseAdmin.storage.from(DOCS_BUCKET).getPublicUrl(obfuscatedPath);
    logger.info({ url: data.publicUrl }, "public file uploaded");
    return data.publicUrl;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "uploadPublicFile threw");
    return null;
  }
}
