import { CustomContext } from "../types"
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  SandboxBusyError,
} from "../util/error"

const errorHandler = async (ctx: CustomContext, next: () => Promise<any>) => {
  try {
    await next()
  } catch (error) {
    ctx.body = {
      error: error.message,
    }
    switch (error.constructor) {
      case BadRequestError:
        ctx.status = 400
        break
      case UnauthorizedError:
        ctx.status = 401
        break
      case ForbiddenError:
        ctx.status = 403
        break
      case NotFoundError:
        ctx.status = 404
        break
      case SandboxBusyError:
        ctx.status = 500
        ctx.body = { status: "busy" }
        break
      default:
        ctx.status = 500
    }
  }
}

export default errorHandler
