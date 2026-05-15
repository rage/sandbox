import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

describe("DOCKER_RUNTIME env var selection", () => {
  afterEach(() => {
    delete process.env["DOCKER_RUNTIME"];
  });

  it("defaults to runc when DOCKER_RUNTIME is not set", () => {
    delete process.env["DOCKER_RUNTIME"];
    expect(() => registerRoutes(Fastify({ logger: false }))).not.toThrow();
  });

  it("selects runsc when DOCKER_RUNTIME=runsc", () => {
    process.env["DOCKER_RUNTIME"] = "runsc";
    expect(() => registerRoutes(Fastify({ logger: false }))).not.toThrow();
  });

  it("falls back to runc for unrecognised DOCKER_RUNTIME values", () => {
    process.env["DOCKER_RUNTIME"] = "unknown-runtime";
    expect(() => registerRoutes(Fastify({ logger: false }))).not.toThrow();
  });
});
