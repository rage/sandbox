import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { SandboxExecutor, buildDockerCreateArgs } from "./sandbox-executor.js";
import type { ExecFileFn, ExtractFileFn, ReadFileFn } from "./sandbox-executor.js";
import type { ResourceLimits, SupportedMimeType } from "../types.js";

const mockLogger: FastifyBaseLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: "info",
  child: vi.fn(() => mockLogger),
};

const defaultLimits: ResourceLimits = { memoryGB: 1, cpus: 1 };

/** Builds a mock ExecFileFn that matches on `file + " " + args.join(" ")` substrings. */
const makeExecFile = (
  overrides: Record<string, { stdout: string; stderr: string } | Error> = {},
): Mock<ExecFileFn> =>
  vi.fn((file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    const cmd = [file, ...args].join(" ");
    for (const [pattern, result] of Object.entries(overrides)) {
      if (cmd.includes(pattern)) {
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      }
    }
    return Promise.resolve({ stdout: "", stderr: "" });
  });

describe("SandboxExecutor", () => {
  describe("docker command building", () => {
    it("should build args starting with 'create'", () => {
      const args = buildDockerCreateArgs(
        "test-container",
        "/path/to/work",
        "nygrenh/sandbox-next",
        { memoryGB: 2, cpus: 1.5 },
        "runc",
      );

      expect(args[0]).toBe("create");
      expect(args).toContain("--name");
      expect(args[args.indexOf("--name") + 1]).toBe("test-container");
      expect(args).toContain("--memory");
      expect(args[args.indexOf("--memory") + 1]).toBe("2G");
      expect(args).toContain("--cpus");
      expect(args[args.indexOf("--cpus") + 1]).toBe("1.5");
      expect(args).toContain("--network");
      expect(args[args.indexOf("--network") + 1]).toBe("none");
      expect(args).toContain("/app/init");
      expect(args[args.length - 1]).toBe("/app/init");
    });

    it("should include all security capability drops", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );

      const capabilities = [
        "SETPCAP",
        "SETFCAP",
        "AUDIT_WRITE",
        "SETGID",
        "SETUID",
        "NET_BIND_SERVICE",
        "SYS_CHROOT",
        "NET_RAW",
      ];
      for (const cap of capabilities) {
        expect(args).toContain(cap);
        const idx = args.lastIndexOf(cap);
        expect(args[idx - 1]).toBe("--cap-drop");
      }
    });

    it("should set network isolation to 'none'", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );
      expect(args[args.indexOf("--network") + 1]).toBe("none");
    });

    it("should set process limits", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );

      expect(args).toContain("--pids-limit=200");
      const ulimitIdx = args.indexOf("--ulimit");
      expect(ulimitIdx).toBeGreaterThanOrEqual(0);
      expect(args[ulimitIdx + 1]).toBe("nproc=10000:10000");
    });

    it("should include kernel memory limit", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );
      expect(args).toContain("--kernel-memory=50M");
    });

    it("should format memory as '<value>G'", () => {
      const testCases: Array<{ memoryGB: number; expected: string }> = [
        { memoryGB: 0.5, expected: "0.5G" },
        { memoryGB: 1, expected: "1G" },
        { memoryGB: 2, expected: "2G" },
        { memoryGB: 4, expected: "4G" },
      ];

      for (const { memoryGB, expected } of testCases) {
        const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB, cpus: 1 }, "runc");
        expect(args[args.indexOf("--memory") + 1]).toBe(expected);
      }
    });

    it("should format CPUs as a string number", () => {
      const testCases: Array<{ cpus: number; expected: string }> = [
        { cpus: 0.1, expected: "0.1" },
        { cpus: 0.5, expected: "0.5" },
        { cpus: 1, expected: "1" },
        { cpus: 2, expected: "2" },
      ];

      for (const { cpus, expected } of testCases) {
        const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus }, "runc");
        expect(args[args.indexOf("--cpus") + 1]).toBe(expected);
      }
    });

    it("should mount work directory as bind mount to /app", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/var/work/submission",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );

      const mountArg = args[args.indexOf("--mount") + 1];
      expect(mountArg).toContain("type=bind");
      expect(mountArg).toContain("target=/app");
      expect(mountArg).toContain("/var/work/submission");
    });

    it("should use the supplied docker image name verbatim", () => {
      const image = "eu.gcr.io/moocfi-public/tmc-sandbox-python:latest";
      const args = buildDockerCreateArgs("test", "/path", image, { memoryGB: 1, cpus: 1 }, "runc");
      expect(args[args.indexOf(image)]).toBe(image);
    });

    it("includes the -it flag", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );
      expect(args).toContain("-it");
    });

    it("sets PYTHONDONTWRITEBYTECODE=1 via --env", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );
      const envIdx = args.indexOf("--env");
      expect(envIdx).toBeGreaterThanOrEqual(0);
      expect(args[envIdx + 1]).toBe("PYTHONDONTWRITEBYTECODE=1");
    });

    it("should not have duplicate consecutive entries for same flags", () => {
      const args = buildDockerCreateArgs(
        "test",
        "/path",
        "image",
        { memoryGB: 1, cpus: 1 },
        "runc",
      );
      // No adjacent duplicate strings except after --cap-drop (which is repeated intentionally).
      const pairsToCheck = args
        .slice(1)
        .map((curr, i) => ({ prev: args[i]!, curr }))
        .filter(({ prev }) => prev !== "--cap-drop");
      for (const { prev, curr } of pairsToCheck) {
        expect(curr).not.toBe(prev);
      }
    });
  });

  describe("resource limits", () => {
    const testCases: Array<{
      limits: ResourceLimits;
      memoryExpected: string;
      cpusExpected: string;
    }> = [
      { limits: { memoryGB: 0.5, cpus: 0.5 }, memoryExpected: "0.5G", cpusExpected: "0.5" },
      { limits: { memoryGB: 1, cpus: 1 }, memoryExpected: "1G", cpusExpected: "1" },
      { limits: { memoryGB: 2, cpus: 1.5 }, memoryExpected: "2G", cpusExpected: "1.5" },
      { limits: { memoryGB: 4, cpus: 2 }, memoryExpected: "4G", cpusExpected: "2" },
    ];

    for (const { limits, memoryExpected, cpusExpected } of testCases) {
      it(`applies limits: ${limits.memoryGB}GB, ${limits.cpus} CPU`, () => {
        const args = buildDockerCreateArgs("test", "/path", "image", limits, "runc");
        expect(args[args.indexOf("--memory") + 1]).toBe(memoryExpected);
        expect(args[args.indexOf("--cpus") + 1]).toBe(cpusExpected);
      });
    }
  });

  describe("execution flow", () => {
    let mockExecFile: Mock<ExecFileFn>;
    let mockReadFile: Mock<ReadFileFn>;
    let mockExtractFile: Mock<ExtractFileFn>;
    let executor: SandboxExecutor;

    beforeEach(() => {
      vi.clearAllMocks();
      mockExecFile = makeExecFile({
        "docker inspect": {
          stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
          stderr: "",
        },
      });
      mockReadFile = vi.fn(
        (path: string, _encoding: BufferEncoding): Promise<string> =>
          Promise.resolve(path.endsWith("exit_code.txt") ? "0" : ""),
      );
      mockExtractFile = vi.fn(
        (_i: string, _o: string, _m: SupportedMimeType): Promise<void> => Promise.resolve(),
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });
    });

    it("calls docker create, cp, chmod, and start in correct order", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-order-test",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;

      const createIdx = calls.findIndex(([f, a]) => f === "docker" && a[0] === "create");
      const cpIdx = calls.findIndex(
        ([f, a]) => f === "docker" && a[0] === "cp" && a.some((x) => x.includes("tmc-run")),
      );
      const startIdx = calls.findIndex(([f, a]) => f === "docker" && a[0] === "start");

      expect(createIdx, "docker create not found").toBeGreaterThanOrEqual(0);
      expect(cpIdx, "docker cp tmc-run not found").toBeGreaterThan(createIdx);
      expect(startIdx, "docker start not found").toBeGreaterThan(cpIdx);
    });

    it("does not pull the docker image when it is already present", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-image-present",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;
      expect(calls.some(([f, a]) => f === "docker" && a[0] === "image" && a[1] === "inspect")).toBe(
        true,
      );
      expect(calls.some(([f, a]) => f === "docker" && a[0] === "pull")).toBe(false);
    });

    it("pulls the docker image only when it is missing locally", async () => {
      mockExecFile = vi.fn(
        (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
          if (file === "docker" && args[0] === "image" && args[1] === "inspect") {
            return Promise.reject(new Error("No such image"));
          }
          if (file === "docker" && args[0] === "inspect") {
            return Promise.resolve({
              stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
              stderr: "",
            });
          }
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-missing-image",
        "eu.gcr.io/moocfi-public/tmc-sandbox-python:latest",
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;
      const inspectIdx = calls.findIndex(
        ([f, a]) => f === "docker" && a[0] === "image" && a[1] === "inspect",
      );
      const pullIdx = calls.findIndex(([f, a]) => f === "docker" && a[0] === "pull");
      const createIdx = calls.findIndex(([f, a]) => f === "docker" && a[0] === "create");

      expect(inspectIdx).toBeGreaterThanOrEqual(0);
      expect(pullIdx).toBeGreaterThan(inspectIdx);
      expect(createIdx).toBeGreaterThan(pullIdx);
    });

    it("returns status=finished when exit_code is 0 and no OOM", async () => {
      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-pass",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("finished");
      expect(result.exitCode).toBe("0");
    });

    it("returns status=out-of-memory when OOMKilled is true", async () => {
      mockExecFile = makeExecFile({
        "docker inspect": {
          stdout: JSON.stringify([{ State: { OOMKilled: true } }]),
          stderr: "",
        },
      });
      mockReadFile = vi.fn(
        (path: string, _encoding: BufferEncoding): Promise<string> =>
          Promise.resolve(path.endsWith("exit_code.txt") ? "137" : ""),
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-oom",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("out-of-memory");
    });

    it("returns status=crashed when docker start fails without timeout", async () => {
      mockExecFile = makeExecFile({
        "docker start": new Error("container exited with code 1"),
        "docker inspect": {
          stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
          stderr: "",
        },
      });
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 60_000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-crash",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("crashed");
    });

    it("awaits container cleanup when docker cp fails after docker create", async () => {
      mockExecFile = vi.fn(
        (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
          if (file === "docker" && args[0] === "cp")
            return Promise.reject(new Error("docker cp failed"));
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await expect(
        executor.executeSubmission(
          "/fake/upload.tar",
          "sub-cp-fail",
          undefined,
          "application/x-tar",
          defaultLimits,
        ),
      ).rejects.toThrow("docker cp failed");

      const rmCall = (mockExecFile.mock.calls as Array<[string, string[]]>).find(
        ([f, a]) => f === "docker" && a[0] === "rm",
      );
      expect(rmCall).toBeDefined();
    });

    it("passes custom docker image to the create command", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-custom-img",
        "eu.gcr.io/moocfi-public/tmc-sandbox-python:latest",
        "application/x-tar",
        defaultLimits,
      );

      const createCall = (mockExecFile.mock.calls as Array<[string, string[]]>).find(
        ([f, a]) => f === "docker" && a[0] === "create",
      );
      expect(createCall?.[1]).toContain("eu.gcr.io/moocfi-public/tmc-sandbox-python:latest");
    });

    it("awaits file cleanup after execution completes", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-cleanup",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const rmCall = (mockExecFile.mock.calls as Array<[string, string[]]>).find(
        ([f, a]) => f === "rm" && a[0] === "-rf",
      );
      expect(rmCall).toBeDefined();
    });

    it("returns status=failed when docker start succeeds but exit_code is non-zero", async () => {
      mockReadFile = vi.fn(
        (path: string, _encoding: BufferEncoding): Promise<string> =>
          Promise.resolve(path.endsWith("exit_code.txt") ? "1" : ""),
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-nonzero",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe("1");
    });

    it("returns status=crashed when exit_code.txt is empty after docker start succeeds", async () => {
      mockReadFile = vi.fn(
        (_path: string, _encoding: BufferEncoding): Promise<string> => Promise.resolve(""),
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-empty-exit",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("crashed");
    });

    it("calls docker cp for the init script in addition to tmc-run", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-cp-init",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;
      const cpInitCall = calls.find(
        ([f, a]) => f === "docker" && a[0] === "cp" && a.some((x) => x.includes("init")),
      );
      expect(cpInitCall, "docker cp init not found").toBeDefined();
    });

    it("calls chmod 755 on tmc-run and init after copying scripts", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-chmod755",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;
      const chmodCall = calls.find(([f, a]) => f === "chmod" && a[0] === "755");
      expect(chmodCall, "chmod 755 not found").toBeDefined();
      expect(chmodCall?.[1]).toContain("755");
    });

    it("does not propagate chmod -R 777 failures (expected on AFS-mounted paths)", async () => {
      const afsExecFile = vi.fn(
        (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
          if (file === "chmod" && args[0] === "-R")
            return Promise.reject(new Error("chmod: not permitted on AFS"));
          if (file === "docker" && args[0] === "inspect")
            return Promise.resolve({
              stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
              stderr: "",
            });
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      );
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: afsExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await expect(
        executor.executeSubmission(
          "/fake/upload.tar",
          "sub-afs",
          undefined,
          "application/x-tar",
          defaultLimits,
        ),
      ).resolves.toMatchObject({ status: "finished" });
    });

    it("warns and continues when docker inspect returns malformed JSON", async () => {
      mockExecFile = makeExecFile({
        "docker inspect": { stdout: "not-valid-json{{", stderr: "" },
      });
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const result = await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-bad-json",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(result.status).toBe("finished");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ submissionId: "sub-bad-json" }),
        "Could not inspect container for OOM status",
      );
    });

    it("propagates extraction errors from extractFileFn", async () => {
      mockExtractFile = vi.fn(() => Promise.reject(new Error("archive is corrupt")));
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await expect(
        executor.executeSubmission(
          "/fake/upload.tar",
          "sub-extract-err",
          undefined,
          "application/x-tar",
          defaultLimits,
        ),
      ).rejects.toThrow("archive is corrupt");
    });

    it("uses container name in the format sandbox-submission-<submissionId>", async () => {
      await executor.executeSubmission(
        "/fake/upload.tar",
        "my-submission-id",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const calls = mockExecFile.mock.calls as Array<[string, string[]]>;
      const createCall = calls.find(([f, a]) => f === "docker" && a[0] === "create");
      const nameIdx = createCall?.[1].indexOf("--name") ?? -1;
      expect(createCall?.[1][nameIdx + 1]).toBe("sandbox-submission-my-submission-id");
    });

    it("logs non-ENOENT errors when reading submission files", async () => {
      mockReadFile = vi.fn((path: string, _encoding: BufferEncoding): Promise<string> => {
        if (path.endsWith("exit_code.txt")) return Promise.resolve("0");
        const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        return Promise.reject(err);
      });
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-eacces",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.anything(), filename: expect.any(String) }),
        "Unexpected error reading submission file",
      );
    });

    it("does not log when submission file is simply missing (ENOENT)", async () => {
      mockReadFile = vi.fn((path: string, _encoding: BufferEncoding): Promise<string> => {
        if (path.endsWith("exit_code.txt")) return Promise.resolve("0");
        const err = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
        return Promise.reject(err);
      });
      executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      vi.clearAllMocks();
      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-enoent",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls as Array<
        [unknown, string]
      >;
      const fileReadErrors = errorCalls.filter(
        ([, msg]) => typeof msg === "string" && msg.includes("Error reading submission file"),
      );
      expect(fileReadErrors).toHaveLength(0);
    });
  });

  describe("timeout handling", () => {
    let mockReadFile: Mock<ReadFileFn>;
    let mockExtractFile: Mock<ExtractFileFn>;

    beforeEach(() => {
      vi.clearAllMocks();
      mockReadFile = vi.fn(
        (path: string, _encoding: BufferEncoding): Promise<string> =>
          Promise.resolve(path.endsWith("exit_code.txt") ? "0" : ""),
      );
      mockExtractFile = vi.fn((): Promise<void> => Promise.resolve());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("kills container after timeout and reports status=timeout", async () => {
      vi.useFakeTimers();

      let rejectDockerStart!: (err: Error) => void;

      const mockExecFile = vi.fn(
        (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
          if (file === "docker" && args[0] === "start") {
            return new Promise((_resolve, reject) => {
              rejectDockerStart = reject;
            });
          }
          if (file === "docker" && args[0] === "kill") {
            rejectDockerStart(new Error("container killed by timeout"));
            return Promise.resolve({ stdout: "", stderr: "" });
          }
          if (file === "docker" && args[0] === "inspect") {
            return Promise.resolve({
              stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
              stderr: "",
            });
          }
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      );

      const executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 1000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const executionPromise = executor.executeSubmission(
        "/fake/upload.tar",
        "sub-timeout",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      await vi.advanceTimersByTimeAsync(1001);
      const result = await executionPromise;

      expect(result.status).toBe("timeout");
      expect(
        (mockExecFile.mock.calls as Array<[string, string[]]>).some(
          ([f, a]) =>
            f === "docker" && a[0] === "kill" && a.includes("sandbox-submission-sub-timeout"),
        ),
      ).toBe(true);
    });

    it("does not kill container before timeout elapses", async () => {
      vi.useFakeTimers();

      let resolveDockerStart!: (val: { stdout: string; stderr: string }) => void;

      const mockExecFile = vi.fn(
        (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
          if (file === "docker" && args[0] === "start") {
            return new Promise((resolve) => {
              resolveDockerStart = resolve;
            });
          }
          if (file === "docker" && args[0] === "inspect") {
            return Promise.resolve({
              stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
              stderr: "",
            });
          }
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      );

      const executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      const executionPromise = executor.executeSubmission(
        "/fake/upload.tar",
        "sub-early",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      await vi.advanceTimersByTimeAsync(4999);

      const killCall = (mockExecFile.mock.calls as Array<[string, string[]]>).find(
        ([f, a]) => f === "docker" && a[0] === "kill",
      );
      expect(killCall).toBeUndefined();

      // Let execution complete cleanly.
      resolveDockerStart({ stdout: "", stderr: "" });
      await executionPromise;
    });

    it("clears timeout timer after normal completion (no kill after container exits)", async () => {
      vi.useFakeTimers();

      const mockExecFile = makeExecFile({
        "docker inspect": {
          stdout: JSON.stringify([{ State: { OOMKilled: false } }]),
          stderr: "",
        },
      });

      const executor = new SandboxExecutor(mockLogger as unknown as FastifyBaseLogger, {
        dockerRuntime: "runc",
        taskTimeoutMs: 5000,
        execFileFn: mockExecFile,
        readFileFn: mockReadFile,
        extractFileFn: mockExtractFile,
      });

      await executor.executeSubmission(
        "/fake/upload.tar",
        "sub-clear-timeout",
        undefined,
        "application/x-tar",
        defaultLimits,
      );

      // Advance well past where the timeout would have fired.
      await vi.advanceTimersByTimeAsync(10_000);

      const killCall = (mockExecFile.mock.calls as Array<[string, string[]]>).find(
        ([f, a]) => f === "docker" && a[0] === "kill",
      );
      expect(killCall).toBeUndefined();
    });
  });
});

describe("buildDockerCreateArgs gVisor (runsc) docker args", () => {
  it("includes --runtime runsc when dockerRuntime is runsc", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runsc");
    const runtimeIdx = args.indexOf("--runtime");
    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(args[runtimeIdx + 1]).toBe("runsc");
  });

  it("does not include --runtime when dockerRuntime is runc", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runc");
    expect(args.indexOf("--runtime")).toBe(-1);
  });

  it("omits --kernel-memory for runsc (unsupported by gVisor)", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runsc");
    expect(args.some((a) => a.startsWith("--kernel-memory"))).toBe(false);
  });

  it("includes --kernel-memory for runc (default)", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runc");
    expect(args.some((a) => a.startsWith("--kernel-memory"))).toBe(true);
  });

  it("runsc still enforces all security capability drops", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runsc");
    const capabilities = [
      "SETPCAP",
      "SETFCAP",
      "AUDIT_WRITE",
      "SETGID",
      "SETUID",
      "NET_BIND_SERVICE",
      "SYS_CHROOT",
      "NET_RAW",
    ];
    for (const cap of capabilities) {
      const idx = args.lastIndexOf(cap);
      expect(idx, `${cap} not found`).toBeGreaterThanOrEqual(0);
      expect(args[idx - 1]).toBe("--cap-drop");
    }
  });

  it("runsc still isolates the network", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runsc");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  it("runsc applies memory and CPU limits", () => {
    const args = buildDockerCreateArgs(
      "test",
      "/path",
      "image",
      { memoryGB: 2, cpus: 1.5 },
      "runsc",
    );
    expect(args[args.indexOf("--memory") + 1]).toBe("2G");
    expect(args[args.indexOf("--cpus") + 1]).toBe("1.5");
  });

  it("runsc --runtime flag appears before the image name", () => {
    const args = buildDockerCreateArgs(
      "test",
      "/path",
      "my-image",
      { memoryGB: 1, cpus: 1 },
      "runsc",
    );
    const runtimeIdx = args.indexOf("--runtime");
    const imageIdx = args.indexOf("my-image");
    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(imageIdx).toBeGreaterThanOrEqual(0);
    expect(runtimeIdx).toBeLessThan(imageIdx);
  });

  it("omits runsc-only flags when dockerRuntime is runc", () => {
    const args = buildDockerCreateArgs("test", "/path", "image", { memoryGB: 1, cpus: 1 }, "runc");
    expect(args.indexOf("--runtime")).toBe(-1);
    expect(args.some((a) => a.startsWith("--kernel-memory"))).toBe(true);
  });
});
