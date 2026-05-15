import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import FormData from "form-data";
import { createHmac } from "node:crypto";
import { registerRoutes } from "./routes.js";
import { handleError } from "./utils/errors.js";
import { SandboxExecutor } from "./services/sandbox-executor.js";
import * as resourceManager from "./services/resource-manager.js";

describe("POST /tasks.json HMAC enforcement", () => {
  let hmacApp: FastifyInstance;
  let previousDockerRuntime: string | undefined;
  const HMAC_SECRET = "test-hmac-secret-xyz";

  function makeForm(opts: { notifySignature?: string } = {}): FormData {
    const form = new FormData();
    form.append("file", Buffer.from("dummy tar content"), {
      filename: "sub.tar",
      contentType: "application/x-tar",
    });
    form.append("notify", "https://example.com/notify");
    form.append("token", "test-token");
    if (opts.notifySignature !== undefined) {
      form.append("notify_signature", opts.notifySignature);
    }
    return form;
  }

  beforeAll(async () => {
    process.env["SANDBOX_CALLBACK_SECRET"] = HMAC_SECRET;
    process.env["SANDBOX_DISABLE_SSRF_CHECK"] = "true";
    previousDockerRuntime = process.env["DOCKER_RUNTIME"];
    process.env["DOCKER_RUNTIME"] = "runc";

    hmacApp = Fastify({ logger: false });
    await hmacApp.register(sensible);
    await hmacApp.register(multipart);
    hmacApp.setErrorHandler(handleError);
    const mockExecutor = new SandboxExecutor(hmacApp.log, {
      dockerRuntime: "runc",
      execFileFn: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
      extractFileFn: vi.fn().mockImplementation(() => Promise.resolve()),
      readFileFn: vi.fn().mockResolvedValue(""),
    });
    registerRoutes(hmacApp, mockExecutor);
  });

  afterAll(async () => {
    delete process.env["SANDBOX_CALLBACK_SECRET"];
    delete process.env["SANDBOX_DISABLE_SSRF_CHECK"];
    if (previousDockerRuntime === undefined) {
      delete process.env["DOCKER_RUNTIME"];
    } else {
      process.env["DOCKER_RUNTIME"] = previousDockerRuntime;
    }
    await hmacApp?.close();
    resourceManager.resetState();
  });

  afterEach(() => resourceManager.resetState());

  it("returns 400 when SANDBOX_CALLBACK_SECRET is set and signature is invalid", async () => {
    const form = makeForm({ notifySignature: "deadbeef".repeat(8) });
    const response = await hmacApp.inject({
      method: "POST",
      url: "/tasks.json",
      headers: form.getHeaders() as Record<string, string>,
      payload: form.getBuffer(),
    });
    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.body) as { error: string }).error).toBe(
      "Invalid notify URL signature",
    );
  });

  it("returns 200 when SANDBOX_CALLBACK_SECRET is set and signature is valid", async () => {
    const notifyUrl = "https://example.com/notify";
    const sig = createHmac("sha256", HMAC_SECRET).update(notifyUrl, "utf8").digest("hex");
    const form = makeForm({ notifySignature: sig });
    const response = await hmacApp.inject({
      method: "POST",
      url: "/tasks.json",
      headers: form.getHeaders() as Record<string, string>,
      payload: form.getBuffer(),
    });
    expect(response.statusCode).toBe(200);
  });

  it("returns 200 when SANDBOX_CALLBACK_SECRET is set but no signature provided (warn-only mode)", async () => {
    const form = makeForm();
    const response = await hmacApp.inject({
      method: "POST",
      url: "/tasks.json",
      headers: form.getHeaders() as Record<string, string>,
      payload: form.getBuffer(),
    });
    expect(response.statusCode).toBe(200);
  });
});
