import type { FastifyReply, FastifyRequest } from "fastify";

export class AppError extends Error {
  override name = "AppError";

  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  override name = "BadRequestError";

  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  override name = "UnauthorizedError";

  constructor(message: string = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  override name = "ForbiddenError";

  constructor(message: string = "Forbidden") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  override name = "NotFoundError";

  constructor(message: string = "Not found") {
    super(404, message);
  }
}

export class SandboxBusyError extends AppError {
  override name = "SandboxBusyError";

  constructor(message: string = "Sandbox is currently busy, please try again later") {
    super(503, message);
  }
}

export class InternalServerError extends AppError {
  override name = "InternalServerError";

  constructor(message: string = "Internal server error") {
    super(500, message);
  }
}

export function handleError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    });
    return;
  }

  if (error instanceof Error) {
    request.log.error({ error }, "Unexpected error");
    reply.code(500).send({
      error: "Internal server error",
      statusCode: 500,
    });
    return;
  }

  request.log.error({ error }, "Unknown non-Error thrown");
  reply.code(500).send({
    error: "Unknown error",
    statusCode: 500,
  });
}
