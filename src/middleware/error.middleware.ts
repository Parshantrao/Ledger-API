import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

/** Errors raised by Express's body parser (malformed JSON, oversized payload, ...). */
function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Route ${req.method} ${req.path} not found.` },
  };
  res.status(404).json(body);
};

/**
 * Central error handler: maps known errors to the standard error format and hides
 * everything else behind a generic 500 (no stack traces or database details leak out).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ErrorBody = { success: false, error: { code: err.code, message: err.message } };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    const body: ErrorBody = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: details[0]?.message ?? 'Invalid request data.',
        details,
      },
    };
    res.status(400).json(body);
    return;
  }

  if (isBodyParserError(err)) {
    const body: ErrorBody = {
      success: false,
      error: {
        code: 'INVALID_REQUEST_BODY',
        message:
          err.type === 'entity.parse.failed' ? 'Malformed JSON request body.' : 'Invalid request.',
      },
    };
    res.status(err.status).json(body);
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error('Unhandled error:', err);
  }
  const body: ErrorBody = {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  };
  res.status(500).json(body);
};
