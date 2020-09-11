class CustomError extends Error {
  constructor(message?: string) {
    super(message)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CustomError)
    }
  }
}

export class NotFoundError extends CustomError {}

export class UnauthorizedError extends CustomError {}

export class ForbiddenError extends CustomError {}

export class BadRequestError extends CustomError {}

export class SandboxBusyError extends CustomError {}

export class InternalServerError extends CustomError {}
