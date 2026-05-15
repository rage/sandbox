import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { registerRoutes } from "./routes.js";
import { handleError } from "./utils/errors.js";

const VALID_LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
type LogLevel = (typeof VALID_LOG_LEVELS)[number];

function resolveLogLevel(): LogLevel {
  const env = process.env["LOG_LEVEL"];
  if (env !== undefined) {
    if (!VALID_LOG_LEVELS.includes(env as LogLevel)) {
      throw new Error(`Invalid LOG_LEVEL "${env}": must be one of ${VALID_LOG_LEVELS.join(", ")}`);
    }
    return env as LogLevel;
  }
  return process.env["NODE_ENV"] === "production" ? "info" : "debug";
}

function buildLoggerConfig() {
  const level = resolveLogLevel();
  if (process.env["NODE_ENV"] === "production") {
    return { level };
  }
  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  };
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : buildLoggerConfig(),
  });

  await app.register(sensible);
  await app.register(cors);
  await app.register(multipart);

  app.setErrorHandler(handleError);

  registerRoutes(app);

  return app;
}
