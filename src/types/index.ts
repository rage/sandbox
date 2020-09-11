import winston from "winston"
import { ParameterizedContext } from "koa"

export interface CustomContext extends ParameterizedContext {
  log: winston.Logger
  requestId: string
}

export interface CustomState {}
