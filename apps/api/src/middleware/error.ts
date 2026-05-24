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
    // diagnose, but only surface field-level errors to the client in dev.
    // In prod the client gets a generic "Invalid request payload" so we
    // don't help attackers map our schemas.
    logger.warn(
      { path: req.path, method: req.method, zod: err.flatten() },
      "validation failed",
    );
    return fail(
      res,
      400,
      "VALIDATION_ERROR",
      "Invalid request payload",
      isProd ? undefined : err.flatten(),
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
