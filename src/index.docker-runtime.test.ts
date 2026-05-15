import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

describe("DOCKER_RUNTIME env var selection", () => {
  let previousDockerRuntime: string | undefined;

  beforeEach(() => {
    previousDockerRuntime = process.env["DOCKER_RUNTIME"];
  });

  afterEach(() => {
    if (previousDockerRuntime === undefined) {
      delete process.env["DOCKER_RUNTIME"];
    } else {
      process.env["DOCKER_RUNTIME"] = previousDockerRuntime;
    }
  });

  it("requires DOCKER_RUNTIME to be set", () => {
    delete process.env["DOCKER_RUNTIME"];
    expect(() => registerRoutes(Fastify({ logger: false }))).toThrow(
      'DOCKER_RUNTIME is required and must be set to "runc" or "runsc"',
    );
  });

  it("selects runc when DOCKER_RUNTIME=runc", () => {
    process.env["DOCKER_RUNTIME"] = "runc";
    expect(() => registerRoutes(Fastify({ logger: false }))).not.toThrow();
  });

  it("selects runsc when DOCKER_RUNTIME=runsc", () => {
    process.env["DOCKER_RUNTIME"] = "runsc";
    expect(() => registerRoutes(Fastify({ logger: false }))).not.toThrow();
  });

  it("rejects unrecognised DOCKER_RUNTIME values", () => {
    process.env["DOCKER_RUNTIME"] = "unknown-runtime";
    expect(() => registerRoutes(Fastify({ logger: false }))).toThrow(
      'Invalid DOCKER_RUNTIME value "unknown-runtime": expected "runc" or "runsc"',
    );
  });
});
