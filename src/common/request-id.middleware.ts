import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const validRequestId = /^[A-Za-z0-9._:-]{1,100}$/;

export class RequestIdMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header("x-request-id");
    const requestId =
      supplied && validRequestId.test(supplied) ? supplied : randomUUID();

    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}
