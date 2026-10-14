import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Express 4 does not forward rejected promises to the error handler, so every
 * async route goes through this wrapper.
 */
export function asyncHandler(route: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    route(req, res, next).catch(next);
  };
}
