import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
  requestId: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body =
      typeof exceptionResponse === "object" && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : {};
    const rawMessage =
      body.message ??
      (typeof exceptionResponse === "string" ? exceptionResponse : undefined);
    const details = Array.isArray(rawMessage)
      ? rawMessage.filter((item): item is string => typeof item === "string")
      : undefined;
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
    const code = isServerError
      ? status === HttpStatus.SERVICE_UNAVAILABLE
        ? "SERVICE_UNAVAILABLE"
        : "INTERNAL_ERROR"
      : status === HttpStatus.BAD_REQUEST
        ? "VALIDATION_FAILED"
        : "HTTP_ERROR";
    const message = isServerError
      ? status === HttpStatus.SERVICE_UNAVAILABLE
        ? "A required service is not ready."
        : "An unexpected error occurred."
      : (details?.[0] ??
        (typeof rawMessage === "string"
          ? rawMessage
          : "The request could not be completed."));
    const requestId =
      response.locals.requestId ??
      request.header("x-request-id") ??
      randomUUID();
    const payload: ErrorBody = {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
      },
      requestId,
    };

    response.setHeader("x-request-id", requestId);
    response.status(status).json(payload);
  }
}
