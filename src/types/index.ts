import winston from "winston"
import { ParameterizedContext } from "koa"

export interface CustomContext extends ParameterizedContext {
  log: winston.Logger
  requestId: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CustomState {}
