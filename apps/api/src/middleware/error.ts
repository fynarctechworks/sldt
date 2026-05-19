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
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  return fail(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
