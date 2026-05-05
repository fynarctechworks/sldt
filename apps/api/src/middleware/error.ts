import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";
import { fail, HttpError } from "../lib/response.js";

export function notFound(_req: Request, res: Response) {
  return fail(res, 404, "NOT_FOUND", "Route not found");
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  if (err instanceof ZodError) {
    return fail(res, 400, "VALIDATION_ERROR", "Invalid request payload", err.flatten());
  }
  if (err instanceof HttpError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }
  logger.error({ err }, "Unhandled error");
  return fail(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
