import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(`Route ${req.method} ${req.path} not found`, 404, 'route_not_found'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.requestId;

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.flatten(),
          requestId,
        },
      });
      return;
    }

    if (err instanceof AppError) {
      if (err.status >= 500) {
        logger.error('request failed', { requestId, code: err.code, message: err.message });
      }
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details, requestId },
      });
      return;
    }

    if (isBodyParserError(err)) {
      res.status(err.status).json({
        error: { code: 'invalid_body', message: 'Request body could not be parsed', requestId },
      });
      return;
    }

    logger.error('unhandled error', {
      requestId,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
    res.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error', requestId },
    });
  };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    (err as { status: number }).status < 500
  );
}
