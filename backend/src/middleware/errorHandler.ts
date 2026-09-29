import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { classifyDatabaseError, DATABASE_FAILURE_HINTS } from '../services/databaseHealth';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.get?.('x-vercel-id') ?? undefined;

  // Database transport and authentication failures: log a clear, actionable
  // hint and tell the client nothing about the upstream response.
  const databaseFailure = classifyDatabaseError(err);
  if (databaseFailure) {
    logger.error(
      { reason: databaseFailure, hint: DATABASE_FAILURE_HINTS[databaseFailure], requestId },
      'Database request failed'
    );
    res.status(503).json({ error: 'Database is temporarily unavailable', requestId });
    return;
  }

  // Errors that set a status code were raised on purpose and carry a message
  // meant for the client. Anything else is unexpected and must not leak.
  const intentional = typeof err.statusCode === 'number';
  const statusCode = err.statusCode ?? 500;
  const message = intentional ? err.message ?? 'Request failed' : 'Internal server error';

  if (statusCode >= 500) {
    logger.error({ err, requestId }, 'Unhandled error');
  } else {
    logger.warn({ statusCode, message }, 'Request error');
  }

  res.status(statusCode).json({
    error: message,
    ...(requestId && statusCode >= 500 && { requestId }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

export function createError(message: string, statusCode: number): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  return err;
}
