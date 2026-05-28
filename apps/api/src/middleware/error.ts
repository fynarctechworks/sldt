import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { fail, HttpError } from "../lib/response.js";

const isProd = env.NODE_ENV === "production";

export function notFound(_req: Request, res: Response) {
  return fail(res, 404, "NOT_FOUND", "Route not found");
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  if (err instanceof ZodError) {
    // Log the full Zod detail server-side regardless of env so devs can
    // diagnose. Surface a human-readable message naming the failing
    // field(s) so staff knows what to fix. Schema shape is already
    // visible in the open-source web client — hiding it server-side
    // only hurts UX without adding security.
    const flat = err.flatten();
    logger.warn(
      { path: req.path, method: req.method, zod: flat },
      "validation failed",
    );
    // Build a short, user-facing summary: "fieldName: message; fieldName: message"
    // Fall back to the first form-level error if no field errors are present.
    const fieldMessages: string[] = [];
    for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
      if (msgs && msgs.length > 0 && msgs[0]) {
        // Convert camelCase to spaced for readability: "guestId" → "guest id"
        const pretty = field.replace(/([A-Z])/g, " $1").toLowerCase();
        fieldMessages.push(`${pretty}: ${msgs[0]}`);
      }
    }
    const formError = flat.formErrors[0];
    const message =
      fieldMessages.length > 0
        ? fieldMessages.join("; ")
        : formError || "Invalid request payload";
    return fail(
      res,
      400,
      "VALIDATION_ERROR",
      message,
      // Include full breakdown in dev for the API debugger; omit in prod
      // to keep responses small.
      isProd ? undefined : flat,
    );
  }
  if (err instanceof HttpError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }
  // Multer errors (file size, file count) surface as plain Errors with
  // helpful messages. Pass those through with 400 since they're caused
  // by the client, not the server.
  if (err instanceof Error && err.name === "MulterError") {
    logger.warn({ err: err.message, path: req.path }, "multer rejected upload");
    return fail(res, 400, "UPLOAD_REJECTED", err.message);
  }
  // express.json() emits a PayloadTooLargeError with status 413 when a
  // request body exceeds our limit. Surface a 413 with our standard
  // envelope rather than the default HTML error page.
  if (
    err &&
    typeof err === "object" &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  ) {
    logger.warn({ path: req.path }, "request body too large");
    return fail(res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }
  // Postgres-driver errors. We translate the small set we care about
  // into stable API codes; everything else falls through to 500.
  // 23P01 = exclusion_violation (the reservation_rooms no-overlap
  //         constraint added in migration 0011). Surfaces if two
  //         concurrent creates race past the advisory lock — which
  //         shouldn't happen, but the constraint is the truthful
  //         bottom-line answer.
  // 23505 = unique_violation (reservation_number, invoice_number,
  //         receipt_number — produced if the sequence ever desyncs).
  if (err && typeof err === "object" && "code" in err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23P01") {
      logger.warn({ path: req.path }, "reservation overlap rejected by exclusion constraint");
      return fail(
        res,
        409,
        "ROOM_UNAVAILABLE",
        "Room was just booked by another session for overlapping dates",
      );
    }
    if (pgCode === "23505") {
      const constraint = (err as { constraint_name?: string }).constraint_name ?? "";
      logger.warn({ path: req.path, constraint }, "unique violation");
      return fail(
        res,
        409,
        "DUPLICATE",
        "Duplicate value — this record already exists",
      );
    }
  }
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  return fail(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
