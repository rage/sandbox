import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import FormData from "form-data";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import { registerRoutes } from "../routes.js";
import { handleError } from "../utils/errors.js";
import { SandboxExecutor } from "../services/sandbox-executor.js";
import { resetState } from "../services/resource-manager.js";
import { createCallbackServer } from "../tests/helpers/create-callback-server.js";
import { SubmissionBuilder } from "../tests/helpers/submission-builder.js";
import type { DockerRuntime } from "../types.js";

const exec = promisify(execCallback);

const PYTHON_IMAGE = "eu.gcr.io/moocfi-public/tmc-sandbox-python:latest";
const MAKE_IMAGE = "eu.gcr.io/moocfi-public/tmc-sandbox-make:latest";
const TASK_TIMEOUT_MS = 15_000;
const TEST_TOKEN = "test-secret-token-abc123";

const REQUIRED_TEMPLATE_DIRS = [
  "/tmp/tmc-langs-rust/sample_exercises/python3/exercise",
  "/tmp/tmc-langs-rust/sample_exercises/make/passing-exercise",
  "/tmp/tmc-langs-rust/sample_exercises/make/failing-exercise",
];

const EMOTICON_TEST_SOURCE = `
import unittest
from tmc import points
from tmc.utils import load_module, reload_module, get_stdout

exercise = 'src.emoticon'

@points('1.emoticon')
class EmoticonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module(exercise, 'en')

    def test_print_emoticon(self):
        reload_module(self.module)
        output = get_stdout()
        self.assertEqual(output.strip(), ':^)', 'Expected output :^)')

if __name__ == '__main__':
    unittest.main()
`.trim();

let passingPythonTar: string;
let failingPythonTar: string;
let timeoutPythonTar: string;
let oomPythonTar: string;
let forkBombPythonTar: string;
let zstdTar: string;
let corruptTar: string;
let emptyTar: string;
let passingMakeTar: string;
let failingMakeTar: string;

let fixturesSkipAll = false;

async function dockerPull(image: string): Promise<boolean> {
  try {
    await exec(`docker pull '${image}'`);
    return true;
  } catch {
    return false;
  }
}

function buildMultipartRequest(
  tarPath: string,
  fields: {
    notify: string;
    token: string;
    dockerImage: string;
    mimeType?: string;
    memoryLimitGb?: number;
    cpuLimit?: number;
    submissionId?: string;
  },
): { headers: Record<string, string>; payload: Buffer } {
  const form = new FormData();
  form.append("file", readFileSync(tarPath), {
    filename: "submission.tar",
    contentType: fields.mimeType ?? "application/x-tar",
  });
  form.append("notify", fields.notify);
  form.append("token", fields.token);
  form.append("docker_image", fields.dockerImage);
  if (fields.memoryLimitGb !== undefined) {
    form.append("memory_limit_gb", String(fields.memoryLimitGb));
  }
  if (fields.cpuLimit !== undefined) {
    form.append("cpu_limit", String(fields.cpuLimit));
  }
  if (fields.submissionId !== undefined) {
    form.append("submission_id", fields.submissionId);
  }
  const payload = form.getBuffer();
  const headers = form.getHeaders() as Record<string, string>;
  return { headers, payload };
}

beforeAll(async () => {
  process.env["SANDBOX_DISABLE_SSRF_CHECK"] = "true";

  const missingDirs = REQUIRED_TEMPLATE_DIRS.filter((d) => !existsSync(d));
  if (missingDirs.length > 0) {
    console.warn(
      `Skipping E2E tests: template directories not found:\n  ${missingDirs.join("\n  ")}`,
    );
    fixturesSkipAll = true;
    return;
  }

  const [pyOk, makeOk] = await Promise.all([dockerPull(PYTHON_IMAGE), dockerPull(MAKE_IMAGE)]);
  if (!pyOk || !makeOk) {
    console.warn("Docker images not available, skipping E2E tests");
    fixturesSkipAll = true;
    return;
  }

  const pythonBuilder = (src: string) =>
    new SubmissionBuilder()
      .withPythonTemplate()
      .addFile("test/test_emoticon.py", EMOTICON_TEST_SOURCE)
      .addFile("src/emoticon.py", src);

  [passingPythonTar, failingPythonTar, timeoutPythonTar, oomPythonTar, forkBombPythonTar] =
    await Promise.all([
      pythonBuilder('print(":^)")').build("tar"),
      pythonBuilder('print("wrong")').build("tar"),
      new SubmissionBuilder()
        .withPythonTemplate()
        .addFile(".tmcproject.yml", "tests_timeout_ms: 120000\n")
        .addFile("test/test_emoticon.py", EMOTICON_TEST_SOURCE)
        .addFile("src/emoticon.py", "import time\nwhile True:\n    time.sleep(0.01)")
        .build("tar"),
      pythonBuilder("x = []\nwhile True:\n    x.append(b'\\x00' * 10_000_000)").build("tar"),
      pythonBuilder("import os\nwhile True:\n    os.fork()").build("tar"),
    ]);

  zstdTar = await pythonBuilder('print(":^)")').build("zstd");

  const SRC_MAKE_PASS = "/tmp/tmc-langs-rust/sample_exercises/make/passing-exercise";
  const SRC_MAKE_FAIL = "/tmp/tmc-langs-rust/sample_exercises/make/failing-exercise";
  const { readFile: readFileAsync } = await import("node:fs/promises");
  [passingMakeTar, failingMakeTar] = await Promise.all([
    Promise.all([
      readFileAsync(join(SRC_MAKE_PASS, "src/source.c"), "utf8"),
      readFileAsync(join(SRC_MAKE_PASS, "src/main.c"), "utf8"),
    ]).then(([srcC, mainC]) =>
      new SubmissionBuilder()
        .withMakeTemplate()
        .addFile("src/source.c", srcC)
        .addFile("src/main.c", mainC)
        .build("tar"),
    ),
    Promise.all([
      readFileAsync(join(SRC_MAKE_FAIL, "src/source.c"), "utf8"),
      readFileAsync(join(SRC_MAKE_FAIL, "src/main.c"), "utf8"),
    ]).then(([srcC, mainC]) =>
      new SubmissionBuilder()
        .withMakeTemplate()
        .addFile("src/source.c", srcC)
        .addFile("src/main.c", mainC)
        .build("tar"),
    ),
  ]);

  corruptTar = join(tmpdir(), "corrupt.tar");
  await writeFile(corruptTar, "this is not a tar file at all!!!!");

  emptyTar = join(tmpdir(), "empty.tar");
  await exec(`tar -cf '${emptyTar}' -T /dev/null`);
}, 180_000);

afterAll(async () => {
  delete process.env["SANDBOX_DISABLE_SSRF_CHECK"];
  await Promise.all(
    [
      passingPythonTar,
      failingPythonTar,
      timeoutPythonTar,
      oomPythonTar,
      forkBombPythonTar,
      zstdTar,
      passingMakeTar,
      failingMakeTar,
      corruptTar,
      emptyTar,
    ]
      .filter(Boolean)
      .map((p) => rm(p, { force: true })),
  );
});

function sandboxSuiteBody(runtime: DockerRuntime) {
  return () => {
    let app: FastifyInstance;
    let skipSuite = false;
    let previousDockerRuntime: string | undefined;
    let dockerRuntimeEnvWasConfigured = false;

    beforeEach(function (ctx) {
      if (fixturesSkipAll || skipSuite) ctx.skip();
    });

    beforeAll(async () => {
      if (fixturesSkipAll) return;
      previousDockerRuntime = process.env["DOCKER_RUNTIME"];
      process.env["DOCKER_RUNTIME"] = runtime;
      dockerRuntimeEnvWasConfigured = true;

      if (runtime === "runsc") {
        try {
          await exec("docker run --rm --runtime=runsc hello-world");
        } catch {
          console.warn("gVisor (runsc) runtime not available, skipping gVisor E2E tests");
          skipSuite = true;
          return;
        }
      }

      app = Fastify({ logger: false });
      await app.register(sensible);
      await app.register(multipart);
      app.setErrorHandler(handleError);
      const executor = new SandboxExecutor(app.log, {
        taskTimeoutMs: TASK_TIMEOUT_MS,
        dockerRuntime: runtime,
      });
      registerRoutes(app, executor);
    }, 60_000);

    afterAll(async () => {
      resetState();
      await app?.close();
      if (dockerRuntimeEnvWasConfigured) {
        if (previousDockerRuntime === undefined) {
          delete process.env["DOCKER_RUNTIME"];
        } else {
          process.env["DOCKER_RUNTIME"] = previousDockerRuntime;
        }
      }
    });

    async function submitAndWait(
      tarPath: string,
      dockerImage: string,
      opts: {
        mimeType?: string;
        memoryLimitGb?: number;
        cpuLimit?: number;
        submissionId?: string;
        callbackTimeoutMs?: number;
      } = {},
    ) {
      const callback = await createCallbackServer(opts.callbackTimeoutMs ?? 60_000);
      const { headers, payload } = buildMultipartRequest(tarPath, {
        notify: callback.url,
        token: TEST_TOKEN,
        dockerImage,
        ...opts,
      });

      const response = await app.inject({
        method: "POST",
        url: "/tasks.json",
        headers,
        payload,
      });

      return { httpResponse: response, result: await callback.waitForResult() };
    }

    describe("passing submissions", () => {
      it("Python exercise: full passing submission checks", { timeout: 60_000 }, async () => {
        const { httpResponse, result } = await submitAndWait(passingPythonTar, PYTHON_IMAGE, {
          submissionId: `test-sub-42-${runtime}`,
        });
        expect(httpResponse.statusCode).toBe(200);
        expect(result.status).toBe("finished");
        expect(result.exit_code).toBe("0");
        expect(result.token).toBe(TEST_TOKEN);
        expect(result.vm_log.length).toBeGreaterThan(0);
        const requiredFields: Array<keyof typeof result> = [
          "token",
          "test_output",
          "stdout",
          "stderr",
          "valgrind",
          "validations",
          "vm_log",
          "status",
          "exit_code",
        ];
        for (const field of requiredFields) {
          expect(result).toHaveProperty(field);
        }
      });

      it("Python passing: test_output contains PASSED status", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(passingPythonTar, PYTHON_IMAGE);
        const testOutput = JSON.parse(result.test_output) as { status: string };
        expect(testOutput.status).toBe("PASSED");
      });

      it("zstd compressed submission works", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(zstdTar, PYTHON_IMAGE, {
          mimeType: "application/zstd",
        });
        expect(result.status).toBe("finished");
      });

      it("Make/C passing exercise returns status='finished'", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(passingMakeTar, MAKE_IMAGE);
        expect(result.status).toBe("finished");
      });
    });

    describe("failing submissions", () => {
      it(
        "Python with wrong output returns status='finished' with TESTS_FAILED",
        { timeout: 60_000 },
        async () => {
          const { result } = await submitAndWait(failingPythonTar, PYTHON_IMAGE);
          expect(result.status).toBe("finished");
          const testOutput = JSON.parse(result.test_output);
          expect(testOutput.status).toBe("TESTS_FAILED");
        },
      );

      it(
        "testResults array is present in test_output for failing submission",
        { timeout: 60_000 },
        async () => {
          const { result } = await submitAndWait(failingPythonTar, PYTHON_IMAGE);
          const testOutput = JSON.parse(result.test_output);
          expect(Array.isArray(testOutput.testResults)).toBe(true);
          expect(testOutput.testResults.length).toBeGreaterThan(0);
        },
      );

      it(
        "failing submission includes the token in the callback payload",
        { timeout: 60_000 },
        async () => {
          const { result } = await submitAndWait(failingPythonTar, PYTHON_IMAGE);
          expect(result.token).toBe(TEST_TOKEN);
        },
      );

      it(
        "Make/C failing exercise returns status='finished' with TESTS_FAILED",
        { timeout: 60_000 },
        async () => {
          const { result } = await submitAndWait(failingMakeTar, MAKE_IMAGE);
          expect(result.status).toBe("finished");
          const testOutput = JSON.parse(result.test_output);
          expect(testOutput.status).toBe("TESTS_FAILED");
        },
      );
    });

    describe("resource management", () => {
      afterEach(() => resetState());

      it(
        "busy_instances returns to 0 after submission completes",
        { timeout: 60_000 },
        async () => {
          const initialRes = await app.inject({ method: "GET", url: "/status.json" });
          const initial = (JSON.parse(initialRes.body) as { busy_instances: number })
            .busy_instances;
          await submitAndWait(passingPythonTar, PYTHON_IMAGE);
          const afterRes = await app.inject({ method: "GET", url: "/status.json" });
          const after = (JSON.parse(afterRes.body) as { busy_instances: number }).busy_instances;
          expect(after).toBe(initial);
        },
      );

      it("returns 503 when resources are fully reserved", async () => {
        const { TOTAL_CPU_CORES, TOTAL_MEMORY_GB, tryReserveResources } =
          await import("../services/resource-manager.js");
        tryReserveResources({ cpus: TOTAL_CPU_CORES, memoryGB: TOTAL_MEMORY_GB });
        const callback = await createCallbackServer(3000);
        const { headers, payload } = buildMultipartRequest(passingPythonTar, {
          notify: callback.url,
          token: TEST_TOKEN,
          dockerImage: PYTHON_IMAGE,
        });
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        callback.close();
        expect(response.statusCode).toBe(503);
      });

      it(
        "reserved_cpu_cores and reserved_memory return to baseline after completion",
        { timeout: 60_000 },
        async () => {
          const beforeRes = await app.inject({ method: "GET", url: "/status.json" });
          const before = JSON.parse(beforeRes.body) as {
            reserved_cpu_cores: number;
            reserved_memory: number;
          };

          await submitAndWait(passingPythonTar, PYTHON_IMAGE);

          const afterRes = await app.inject({ method: "GET", url: "/status.json" });
          const after = JSON.parse(afterRes.body) as {
            reserved_cpu_cores: number;
            reserved_memory: number;
          };
          expect(after.reserved_cpu_cores).toBe(before.reserved_cpu_cores);
          expect(after.reserved_memory).toBe(before.reserved_memory);
        },
      );

      it("accepts custom memory_limit_gb and completes", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(passingPythonTar, PYTHON_IMAGE, {
          memoryLimitGb: 2,
        });
        expect(result.status).toBe("finished");
      });

      it("accepts custom cpu_limit and completes", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(passingPythonTar, PYTHON_IMAGE, {
          cpuLimit: 2,
        });
        expect(result.status).toBe("finished");
      });

      it("releases resources even when submission crashes", { timeout: 60_000 }, async () => {
        const beforeRes = await app.inject({ method: "GET", url: "/status.json" });
        const before = (JSON.parse(beforeRes.body) as { busy_instances: number }).busy_instances;

        await submitAndWait(corruptTar, PYTHON_IMAGE, { callbackTimeoutMs: 10_000 }).catch(
          () => {},
        );
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        });

        const afterRes = await app.inject({ method: "GET", url: "/status.json" });
        const after = (JSON.parse(afterRes.body) as { busy_instances: number }).busy_instances;
        expect(after).toBeLessThanOrEqual(before);
      });
    });

    describe("error scenarios", () => {
      it("OOM submission returns status='out-of-memory'", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(oomPythonTar, PYTHON_IMAGE, {
          callbackTimeoutMs: 60_000,
        });
        expect(result.status).toBe("out-of-memory");
      });

      it("OOM submission includes token in callback payload", { timeout: 60_000 }, async () => {
        const { result } = await submitAndWait(oomPythonTar, PYTHON_IMAGE, {
          callbackTimeoutMs: 60_000,
        });
        expect(result.token).toBe(TEST_TOKEN);
      });

      it(
        "empty tar submission does not hang (completes with any status)",
        { timeout: 60_000 },
        async () => {
          const { result } = await submitAndWait(emptyTar, PYTHON_IMAGE, {
            callbackTimeoutMs: 60_000,
          });
          expect(result.status).toBeDefined();
          expect(["finished", "failed", "crashed", "timeout", "out-of-memory"]).toContain(
            result.status,
          );
        },
      );

      it(
        "fork bomb: status is finished or failed (does not hang)",
        { timeout: 60_000 },
        async (ctx) => {
          if (process.env.CI) {
            ctx.skip();
          }
          const { result } = await submitAndWait(forkBombPythonTar, PYTHON_IMAGE, {
            callbackTimeoutMs: 60_000,
          });
          expect(["finished", "failed", "crashed"]).toContain(result.status);
        },
      );

      it("corrupt tar returns HTTP 200 (async) or immediate error (400/500)", async () => {
        const callback = await createCallbackServer(5000);
        const { headers, payload } = buildMultipartRequest(corruptTar, {
          notify: callback.url,
          token: TEST_TOKEN,
          dockerImage: PYTHON_IMAGE,
        });
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect([200, 400, 500]).toContain(response.statusCode);
        callback.close();
      });
    });

    describe("timeout scenario", () => {
      it(
        "infinite loop returns status='timeout' after executor timeout",
        { timeout: 30_000 },
        async () => {
          const { result } = await submitAndWait(timeoutPythonTar, PYTHON_IMAGE, {
            callbackTimeoutMs: 25_000,
          });
          expect(result.status).toBe("timeout");
        },
      );

      it("timeout submission includes token in callback payload", { timeout: 30_000 }, async () => {
        const { result } = await submitAndWait(timeoutPythonTar, PYTHON_IMAGE, {
          callbackTimeoutMs: 25_000,
        });
        expect(result.token).toBe(TEST_TOKEN);
      });

      it("reserved_cpu_cores returns to baseline after timeout", { timeout: 30_000 }, async () => {
        const beforeRes = await app.inject({ method: "GET", url: "/status.json" });
        const before = JSON.parse(beforeRes.body) as { reserved_cpu_cores: number };

        await submitAndWait(timeoutPythonTar, PYTHON_IMAGE, { callbackTimeoutMs: 25_000 });

        const afterRes = await app.inject({ method: "GET", url: "/status.json" });
        const after = JSON.parse(afterRes.body) as { reserved_cpu_cores: number };
        expect(after.reserved_cpu_cores).toBe(before.reserved_cpu_cores);
      });
    });

    describe("concurrent submissions", () => {
      it("two simultaneous Python submissions both complete", { timeout: 90_000 }, async () => {
        const [r1, r2] = await Promise.all([
          submitAndWait(passingPythonTar, PYTHON_IMAGE, { callbackTimeoutMs: 80_000 }),
          submitAndWait(passingPythonTar, PYTHON_IMAGE, { callbackTimeoutMs: 80_000 }),
        ]);
        expect(r1.result.status).toBe("finished");
        expect(r2.result.status).toBe("finished");
      });

      it("two simultaneous failing submissions both complete", { timeout: 90_000 }, async () => {
        const [r1, r2] = await Promise.all([
          submitAndWait(failingPythonTar, PYTHON_IMAGE, { callbackTimeoutMs: 80_000 }),
          submitAndWait(failingPythonTar, PYTHON_IMAGE, { callbackTimeoutMs: 80_000 }),
        ]);
        expect(r1.result.status).toBe("finished");
        expect(r2.result.status).toBe("finished");
      });
    });

    describe("HTTP request validation", () => {
      function buildRawForm(
        fields: Record<string, string>,
        tarPath: string,
      ): { headers: Record<string, string>; payload: Buffer } {
        const form = new FormData();
        form.append("file", readFileSync(tarPath), {
          filename: "submission.tar",
          contentType: "application/x-tar",
        });
        for (const [k, v] of Object.entries(fields)) {
          form.append(k, v);
        }
        return {
          headers: form.getHeaders() as Record<string, string>,
          payload: form.getBuffer(),
        };
      }

      it("returns 400 when docker_image is not whitelisted", async () => {
        const { headers, payload } = buildRawForm(
          {
            notify: "https://example.com/notify",
            token: TEST_TOKEN,
            docker_image: "evil/unauthorized-image:latest",
          },
          passingPythonTar,
        );
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      });

      it("returns 400 when docker_image is an empty string", async () => {
        const { headers, payload } = buildRawForm(
          {
            notify: "https://example.com/notify",
            token: TEST_TOKEN,
            docker_image: "",
          },
          passingPythonTar,
        );
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      });

      it("returns 400 when token is missing", async () => {
        const { headers, payload } = buildRawForm(
          { notify: "https://example.com/notify" },
          passingPythonTar,
        );
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      });

      it("returns 400 when notify URL is missing", async () => {
        const { headers, payload } = buildRawForm({ token: TEST_TOKEN }, passingPythonTar);
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      });

      it("returns 400 when notify URL is not a valid URL", async () => {
        const { headers, payload } = buildRawForm(
          { notify: "not-a-url", token: TEST_TOKEN },
          passingPythonTar,
        );
        const response = await app.inject({
          method: "POST",
          url: "/tasks.json",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(400);
      });
    });
  };
}

// vitest/valid-describe-callback: factory must be invoked inside describe body
// eslint-disable-next-line vitest/valid-describe-callback
describe("E2E Sandbox Execution (default/runc)", () => {
  sandboxSuiteBody("runc")();
});
// eslint-disable-next-line vitest/valid-describe-callback
describe("E2E Sandbox Execution (gVisor/runsc)", () => {
  sandboxSuiteBody("runsc")();
});
