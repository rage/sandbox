import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import FormData from "form-data";
import { registerRoutes } from "./routes.js";
import { handleError } from "./utils/errors.js";
import type { SandboxExecutor } from "./services/sandbox-executor.js";
import { resetState, TOTAL_CPU_CORES, tryReserveResources } from "./services/resource-manager.js";
import type { SubmissionResult } from "./types.js";

const TEST_IMAGE = "eu.gcr.io/moocfi-public/tmc-sandbox-python:latest";

const successfulResult: SubmissionResult = {
  testOutput: "",
  stdout: "",
  stderr: "",
  valgrind: "",
  validations: "",
  vmLog: "",
  status: "finished",
  exitCode: "0",
};

let previousDockerRuntime: string | undefined;

async function buildTestApp(executeSubmission: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(multipart);
  app.setErrorHandler(handleError);
  registerRoutes(app, { executeSubmission } as unknown as SandboxExecutor);
  return app;
}

function buildForm(opts: { submissionId?: string } = {}): {
  headers: Record<string, string>;
  payload: Buffer;
} {
  const form = new FormData();
  form.append("file", Buffer.from("dummy tar content"), {
    filename: "submission.tar",
    contentType: "application/x-tar",
  });
  form.append("notify", "https://example.com/notify");
  form.append("token", "test-token");
  form.append("docker_image", TEST_IMAGE);
  if (opts.submissionId !== undefined) {
    form.append("submission_id", opts.submissionId);
  }

  return {
    headers: form.getHeaders() as Record<string, string>,
    payload: form.getBuffer(),
  };
}

function stubFetch(
  response: Response = new Response(null, { status: 200 }),
  expectedCalls = 1,
): {
  fetchCalled: Promise<RequestInit | undefined>;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  let calls = 0;
  let resolveFetch!: (init: RequestInit | undefined) => void;
  const fetchCalled = new Promise<RequestInit | undefined>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (calls === expectedCalls) {
      resolveFetch(init);
    }
    return Promise.resolve(response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchCalled, fetchMock };
}

beforeEach(() => {
  previousDockerRuntime = process.env["DOCKER_RUNTIME"];
  process.env["DOCKER_RUNTIME"] = "runc";
});

afterEach(() => {
  if (previousDockerRuntime === undefined) {
    delete process.env["DOCKER_RUNTIME"];
  } else {
    process.env["DOCKER_RUNTIME"] = previousDockerRuntime;
  }
  vi.unstubAllGlobals();
  resetState();
});

describe("registerRoutes", () => {
  it("accepts multipart fields that arrive after the file part", async () => {
    const executeSubmission = vi.fn().mockResolvedValue(successfulResult);
    const app = await buildTestApp(executeSubmission);
    const { fetchCalled } = stubFetch();
    const { headers, payload } = buildForm();

    const response = await app.inject({
      method: "POST",
      url: "/tasks.json",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    await fetchCalled;
    expect(executeSubmission).toHaveBeenCalledTimes(1);
    expect(executeSubmission.mock.calls[0]?.[2]).toBe(TEST_IMAGE);
    expect(executeSubmission.mock.calls[0]?.[3]).toBe("application/x-tar");

    await app.close();
  });

  it("rejects busy submissions before accepting an upload slot", async () => {
    expect(tryReserveResources({ cpus: TOTAL_CPU_CORES, memoryGB: 0 })).toBe(true);
    const executeSubmission = vi.fn().mockResolvedValue(successfulResult);
    const app = await buildTestApp(executeSubmission);
    const { headers, payload } = buildForm();

    const response = await app.inject({
      method: "POST",
      url: "/tasks.json",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(503);
    expect(executeSubmission).not.toHaveBeenCalled();

    await app.close();
  });

  it("uses unique internal execution IDs instead of client submission_id", async () => {
    let executionCount = 0;
    let resolveExecutedTwice!: () => void;
    const executedTwice = new Promise<void>((resolve) => {
      resolveExecutedTwice = resolve;
    });
    const executeSubmission = vi.fn().mockImplementation(() => {
      executionCount += 1;
      if (executionCount === 2) {
        resolveExecutedTwice();
      }
      return Promise.resolve(successfulResult);
    });
    const app = await buildTestApp(executeSubmission);
    const { fetchCalled } = stubFetch(undefined, 2);

    const first = buildForm({ submissionId: "client-retry-id" });
    const firstResponse = await app.inject({
      method: "POST",
      url: "/tasks.json",
      headers: first.headers,
      payload: first.payload,
    });
    const second = buildForm({ submissionId: "client-retry-id" });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/tasks.json",
      headers: second.headers,
      payload: second.payload,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);

    await executedTwice;
    await fetchCalled;
    const executionIds = executeSubmission.mock.calls.map((call) => call[1]);
    expect(executionIds).toHaveLength(2);
    expect(executionIds).not.toContain("client-retry-id");
    expect(new Set(executionIds).size).toBe(2);

    await app.close();
  });

  it("does not follow callback redirects", async () => {
    const executeSubmission = vi.fn().mockResolvedValue(successfulResult);
    const app = await buildTestApp(executeSubmission);
    const { fetchCalled, fetchMock } = stubFetch(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/" },
      }),
    );
    const { headers, payload } = buildForm();

    const response = await app.inject({
      method: "POST",
      url: "/tasks.json",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(200);
    const fetchInit = await fetchCalled;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchInit?.redirect).toBe("manual");

    await app.close();
  });
});
