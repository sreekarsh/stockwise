import logger from "../services/logger.js";
import { logBuffer } from "../services/logBuffer.js";

export class AppError extends Error {
  statusCode: number;
  details: any;
  constructor(message: string, statusCode = 500, details: any = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = "AppError";
  }
}

export function errorHandler(err: any, req: any, res: any, next: any) {
  if (!err) {
    return res.status(500).json({ error: "Internal server error" });
  }
  const statusCode = err.statusCode || 500;
  const body: Record<string, any> = {};
  if (statusCode >= 500) {
    logger.error({ err, statusCode, path: req?.path }, err.message || "Internal error");
    body.error = "Internal server error";
  } else {
    logger.error({ err, statusCode, path: req?.path }, err.message || "Client error");
    body.error = err.message;
    if (err.details) body.details = err.details;
  }
  logBuffer.trackError(err.message || String(err), err.stack, req?.path, statusCode);
  res.status(statusCode).json(body);
}

export function wrapAsync(fn: any) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
