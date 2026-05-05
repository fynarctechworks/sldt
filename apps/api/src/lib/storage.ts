import { supabaseAdmin } from "./supabase.js";

const BUCKET = "kyc-docs";

export type KycSide = "front" | "back";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 8 * 1024 * 1024;

export function validateKycFile(file: { mimetype: string; size: number }): string | null {
  if (!ALLOWED_MIME.has(file.mimetype)) return "File must be JPEG, PNG, WEBP, or PDF";
  if (file.size > MAX_BYTES) return "File must be under 8 MB";
  return null;
}

export async function uploadKycPhoto(
  guestId: string,
  side: KycSide,
  file: { buffer: Buffer; mimetype: string },
): Promise<string> {
  const ext = file.mimetype === "application/pdf" ? "pdf" : file.mimetype.split("/")[1];
  const path = `${guestId}/${side}-${Date.now()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
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
