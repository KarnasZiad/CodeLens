import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** An error that maps to an RFC 9457 problem response. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ?? TITLES[status] ?? `HTTP ${status}`);
    this.name = 'HttpProblem';
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpProblem(404));
};

function statusOf(error: unknown): number {
  if (error instanceof HttpProblem) return error.status;
  // body-parser errors carry a status (413 entity.too.large, 400 entity.parse.failed, 415).
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number(error.status);
    if (status >= 400 && status < 500) return status;
  }
  return 500;
}

/** Problem details for every error; server errors are logged and never described to the client. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    const status = statusOf(error);
    if (status >= 500) logger.error({ err: error, requestId: request.id }, 'request failed');
    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: TITLES[status] ?? 'Error',
        status,
        ...(error instanceof HttpProblem && error.detail ? { detail: error.detail } : {}),
        instance: request.originalUrl.split('?')[0],
      });
  };
}
