import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { registerRoutes } from "./routes.js";
import { handleError } from "./utils/errors.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
  });

  await app.register(sensible);
  await app.register(multipart);

  app.setErrorHandler(handleError);

  registerRoutes(app);

  return app;
}
