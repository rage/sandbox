import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import { extractFile } from "./file-extractor.js";
import type {
  DockerRuntime,
  ResourceLimits,
  SubmissionResult,
  SupportedMimeType,
} from "../types.js";

const DEFAULT_TASK_TIMEOUT_MS = 180_000;
const DEFAULT_DOCKER_IMAGE = "nygrenh/sandbox-next";
// Three dirnames: src/services/ -> src/ -> project root, where tmc-run and init scripts live.
const SCRIPTS_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const WORK_DIR = join(SCRIPTS_DIR, "work");

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;
export type ReadFileFn = (path: string, encoding: BufferEncoding) => Promise<string>;
export type ExtractFileFn = typeof extractFile;

/** Error thrown by the default execFile implementation; carries stdout/stderr from the process. */
class ExecError extends Error {
  override name = "ExecError";
  readonly code: string | number | null | undefined;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    code: string | number | null | undefined,
    stdout: string,
    stderr: string,
  ) {
    super(message);
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

export interface SandboxExecutorOptions {
  dockerRuntime: DockerRuntime;
  taskTimeoutMs?: number;
  execFileFn?: ExecFileFn;
  readFileFn?: ReadFileFn;
  extractFileFn?: ExtractFileFn;
}

export function buildDockerCreateArgs(
  containerId: string,
  path: string,
  image: string,
  resourceLimits: ResourceLimits,
  dockerRuntime: DockerRuntime,
): string[] {
  return [
    "create",
    "--name",
    containerId,
    // gVisor runtime flag — only added when using runsc
    ...(dockerRuntime === "runsc" ? ["--runtime", "runsc"] : []),
    "--network",
    "none",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    "--memory",
    `${resourceLimits.memoryGB}G`,
    // --kernel-memory is unsupported by gVisor (runsc) and deprecated in Docker 20.10+
    // (no-op on cgroups v2); kept for cgroups v1 compatibility.
    ...(dockerRuntime === "runc" ? ["--kernel-memory=50M"] : []),
    "--pids-limit=200",
    "--ulimit",
    "nproc=10000:10000",
    "--cpus",
    String(resourceLimits.cpus),
    "--cap-drop",
    "SETPCAP",
    "--cap-drop",
    "SETFCAP",
    "--cap-drop",
    "AUDIT_WRITE",
    "--cap-drop",
    "SETGID",
    "--cap-drop",
    "SETUID",
    "--cap-drop",
    "NET_BIND_SERVICE",
    "--cap-drop",
    "SYS_CHROOT",
    "--cap-drop",
    "NET_RAW",
    "--mount",
    `type=bind,source=${resolve(path)},target=/app`,
    "-it",
    image,
    "/app/init",
  ];
}

function defaultExecFile(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((_resolve, reject) => {
    execFileCallback(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(new ExecError(error.message, error.code, stdout, stderr));
      } else {
        _resolve({ stdout, stderr });
      }
    });
  });
}

export class SandboxExecutor {
  private logger: FastifyBaseLogger;
  private taskTimeoutMs: number;
  private execFileFn: ExecFileFn;
  private readFileFn: ReadFileFn;
  private extractFileFn: ExtractFileFn;
  private dockerRuntime: DockerRuntime;

  constructor(logger: FastifyBaseLogger, opts: SandboxExecutorOptions) {
    this.logger = logger;
    this.taskTimeoutMs = opts.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.execFileFn = opts.execFileFn ?? defaultExecFile;
    this.readFileFn = opts.readFileFn ?? readFile;
    this.extractFileFn = opts.extractFileFn ?? extractFile;
    this.dockerRuntime = opts.dockerRuntime;
  }

  async executeSubmission(
    filePath: string,
    submissionId: string,
    dockerImage: string | undefined,
    mimetype: SupportedMimeType,
    resourceLimits: ResourceLimits,
  ): Promise<SubmissionResult> {
    const log = this.logger.child({ submissionId });
    const startTime = Date.now();
    log.info("Starting submission execution");

    const outputPath = join(WORK_DIR, submissionId);
    let result: SubmissionResult;

    try {
      await this.extractFileFn(filePath, outputPath, mimetype);
      log.debug("File extraction complete");

      try {
        await this.execFileFn("chmod", ["-R", "777", outputPath]);
      } catch {
        // chmod may fail on AFS-mounted paths; this is expected
      }

      result = await this.runTests(outputPath, submissionId, dockerImage, resourceLimits, log);
    } catch (error) {
      log.error({ error }, "Submission execution failed");
      throw error;
    } finally {
      await this.cleanupFiles(filePath, outputPath, log);
    }

    const durationMs = Date.now() - startTime;
    log.info(
      { status: result.status, exitCode: result.exitCode, durationMs },
      "Submission complete",
    );

    return result;
  }

  private async runTests(
    path: string,
    submissionId: string,
    dockerImage: string | undefined,
    resourceLimits: ResourceLimits,
    log: FastifyBaseLogger,
  ): Promise<SubmissionResult> {
    const containerId = `sandbox-submission-${submissionId}`;
    const image = dockerImage ?? DEFAULT_DOCKER_IMAGE;
    const timeoutMs = this.taskTimeoutMs;

    await this.ensureDockerImageAvailable(image, log);

    const dockerArgs = buildDockerCreateArgs(
      containerId,
      path,
      image,
      resourceLimits,
      this.dockerRuntime,
    );

    log.debug({ containerId, image }, "Creating container");
    await this.execFileFn("docker", dockerArgs);

    // If any setup step fails, clean up the created container before rethrowing.
    try {
      await this.execFileFn("docker", [
        "cp",
        join(SCRIPTS_DIR, "tmc-run"),
        `${containerId}:/app/tmc-run`,
      ]);
      await this.execFileFn("docker", [
        "cp",
        join(SCRIPTS_DIR, "init"),
        `${containerId}:/app/init`,
      ]);
      // Make scripts executable inside the bind-mount (chmod +x is masked on AFS; use octal)
      await this.execFileFn("chmod", ["755", join(path, "tmc-run"), join(path, "init")]);
    } catch (error) {
      await this.cleanupContainer(containerId, log);
      throw error;
    }

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void (async () => {
        try {
          await this.execFileFn("docker", ["kill", containerId]);
          log.warn({ containerId }, "Container killed due to timeout");
        } catch {
          // Already dead
        }
      })();
    }, timeoutMs);

    let result: SubmissionResult;
    try {
      result = await this.collectResults(path, containerId, submissionId, () => timedOut, log);
    } finally {
      clearTimeout(timeoutHandle);
      await this.cleanupContainer(containerId, log);
    }

    return result;
  }

  private async ensureDockerImageAvailable(image: string, log: FastifyBaseLogger): Promise<void> {
    try {
      await this.execFileFn("docker", ["image", "inspect", image]);
      return;
    } catch {
      log.info({ image }, "Docker image not found locally; pulling");
    }

    await this.execFileFn("docker", ["pull", image]);
  }

  private async collectResults(
    path: string,
    containerId: string,
    submissionId: string,
    isTimedOut: () => boolean,
    log: FastifyBaseLogger,
  ): Promise<SubmissionResult> {
    let status: SubmissionResult["status"] = "failed";
    let exitCode = "";
    let vmLog = "";

    try {
      const processLog = await this.execFileFn("docker", ["start", "-i", containerId]);
      vmLog = processLog.stdout + processLog.stderr;
      log.debug("Container execution complete");

      const rawExitCode = await this.readSubmissionFile(path, "exit_code.txt", log);
      exitCode = rawExitCode.trim();
      if (!exitCode) {
        throw new Error("tmc-run did not exit properly");
      }
    } catch (error: unknown) {
      if (error instanceof ExecError) {
        vmLog = error.stdout + error.stderr;
      }

      log.error({ error, timedOut: isTimedOut() }, "Container execution failed");

      status = isTimedOut() ? "timeout" : "crashed";
    }

    // Check for OOM
    try {
      const inspection = await this.execFileFn("docker", ["inspect", containerId]);
      const parsed = JSON.parse(inspection.stdout);
      if (Array.isArray(parsed) && Boolean(parsed[0]?.State?.OOMKilled)) {
        status = "out-of-memory";
        log.warn({ containerId }, "Container killed by OOM");
      }
    } catch {
      log.warn({ submissionId }, "Could not inspect container for OOM status");
    }

    const [testOutput, stdout, stderr, valgrind, validations] = await Promise.all([
      this.readSubmissionFile(path, "test_output.txt", log),
      this.readSubmissionFile(path, "stdout.txt", log),
      this.readSubmissionFile(path, "stderr.txt", log),
      this.readSubmissionFile(path, "valgrind.log", log),
      this.readSubmissionFile(path, "validations.json", log),
    ]);

    if (status !== "timeout" && status !== "out-of-memory" && exitCode === "0") {
      status = "finished";
    }

    if (process.env["PRINT_VM_LOG"]) {
      log.debug({ vmLog }, "VM log");
    }

    return {
      testOutput,
      stdout,
      stderr,
      valgrind,
      validations,
      vmLog,
      exitCode,
      status,
    };
  }

  private async readSubmissionFile(
    dir: string,
    filename: string,
    log: FastifyBaseLogger,
  ): Promise<string> {
    try {
      return await this.readFileFn(join(dir, filename), "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return "";
      }
      log.error({ error, filename }, "Unexpected error reading submission file");
      return "";
    }
  }

  private async cleanupContainer(containerId: string, log: FastifyBaseLogger): Promise<void> {
    try {
      await this.execFileFn("docker", ["rm", "--force", containerId]);
    } catch (error) {
      log.error({ containerId, error }, "Failed to clean up container");
    }
  }

  private async cleanupFiles(
    filePath: string,
    outputPath: string,
    log: FastifyBaseLogger,
  ): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Upload file may already be gone
    }
    try {
      // Files owned by the container's uid may remain; that's acceptable.
      await this.execFileFn("rm", ["-rf", resolve(outputPath)]);
    } catch (error) {
      log.error({ error }, "Failed to clean up work directory");
    }
  }
}
