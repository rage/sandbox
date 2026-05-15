import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MimeTypeSchema, TaskPayloadSchema } from "./schemas.js";
import {
  TOTAL_CPU_CORES,
  TOTAL_MEMORY_GB,
  getBusyInstances,
  getReservedCpuCores,
  getReservedMemory,
  releaseResources,
  tryResizeReservedResources,
  tryReserveResources,
} from "./services/resource-manager.js";
import { SandboxExecutor } from "./services/sandbox-executor.js";
import { BadRequestError, SandboxBusyError } from "./utils/errors.js";
import { verifyHmacSha256 } from "./utils/hmac.js";
import type {
  DockerRuntime,
  ResourceLimits,
  StatusResponse,
  SubmissionResult,
  TaskResponse,
} from "./types.js";

const DEFAULT_MEMORY_GB = 1;
const DEFAULT_CPUS = 1;
const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryGB: DEFAULT_MEMORY_GB,
  cpus: DEFAULT_CPUS,
};
const NOTIFY_TIMEOUT_MS = 30_000;

type MultipartFields = Record<string, string | undefined>;

function readDockerRuntimeFromEnv(): DockerRuntime {
  const runtime = process.env["DOCKER_RUNTIME"];

  if (runtime === "runc" || runtime === "runsc") {
    return runtime;
  }

  if (runtime === undefined || runtime === "") {
    throw new Error('DOCKER_RUNTIME is required and must be set to "runc" or "runsc"');
  }

  throw new Error(`Invalid DOCKER_RUNTIME value "${runtime}": expected "runc" or "runsc"`);
}

function multipartFieldValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function numberField(fields: MultipartFields, name: string): number | undefined {
  const value = fields[name];
  return value === undefined ? undefined : Number(value);
}

export function registerRoutes(app: FastifyInstance, executor?: SandboxExecutor): void {
  // Read at registration time so tests can set the env var before building the app.
  // If set, callbacks without a valid HMAC-SHA256 signature will be warned (future: rejected).
  // TODO: Reject unsigned callbacks once all clients are updated to sign requests.
  const callbackSecret = process.env["SANDBOX_CALLBACK_SECRET"];
  const runtime = readDockerRuntimeFromEnv();
  const exec = executor ?? new SandboxExecutor(app.log, { dockerRuntime: runtime });

  app.get<{ Reply: StatusResponse }>("/status.json", (): StatusResponse => {
    return {
      busy_instances: getBusyInstances(),
      reserved_cpu_cores: getReservedCpuCores(),
      total_instances: TOTAL_CPU_CORES,
      reserved_memory: getReservedMemory(),
      total_memory: TOTAL_MEMORY_GB,
    };
  });

  app.post<{ Reply: TaskResponse }>(
    "/tasks.json",
    async (request: FastifyRequest, _reply: FastifyReply): Promise<TaskResponse> => {
      const fields: MultipartFields = {};
      let uploadTmpDir = "";
      let uploadPath = "";
      let uploadMimeType = "";
      let reservedLimits: ResourceLimits | undefined;

      const cleanupUpload = async (): Promise<void> => {
        if (uploadTmpDir) {
          try {
            await rm(uploadTmpDir, { recursive: true, force: true });
          } catch {
            // temp dir may already be gone
          }
        }
      };

      const releaseReservedResources = (): void => {
        if (reservedLimits) {
          releaseResources(reservedLimits);
          reservedLimits = undefined;
        }
      };

      if (!tryReserveResources(DEFAULT_RESOURCE_LIMITS)) {
        throw new SandboxBusyError();
      }
      reservedLimits = DEFAULT_RESOURCE_LIMITS;

      try {
        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (uploadPath) {
              throw new BadRequestError("Only one file provided");
            }
            uploadMimeType = part.mimetype;
            uploadTmpDir = await mkdtemp(join(tmpdir(), "sandbox-upload-"));
            uploadPath = join(uploadTmpDir, `${randomUUID()}.upload`);
            await pipeline(part.file, createWriteStream(uploadPath));
          } else {
            fields[part.fieldname] = multipartFieldValue(part.value);
          }
        }
      } catch (error) {
        await cleanupUpload();
        releaseReservedResources();
        throw error;
      }

      if (!uploadPath) {
        releaseReservedResources();
        throw new BadRequestError("No file provided");
      }

      let taskPayload: z.infer<typeof TaskPayloadSchema>;
      try {
        taskPayload = TaskPayloadSchema.parse({
          submissionId: fields["submission_id"],
          dockerImage: fields["docker_image"],
          memoryLimitGb: numberField(fields, "memory_limit_gb"),
          cpuLimit: numberField(fields, "cpu_limit"),
          notify: fields["notify"],
          token: fields["token"],
          notifySignature: fields["notify_signature"],
        });
      } catch (error) {
        await cleanupUpload();
        releaseReservedResources();
        if (error instanceof z.ZodError) {
          throw new BadRequestError(
            `Invalid request: ${error.issues.map((issue) => issue.message).join(", ")}`,
          );
        }
        throw error;
      }

      // Experimental: verify HMAC signature if a secret is configured.
      // TODO: Once all clients send notifySignature, reject unsigned callbacks here.
      if (callbackSecret) {
        if (taskPayload.notifySignature) {
          if (!verifyHmacSha256(taskPayload.notify, taskPayload.notifySignature, callbackSecret)) {
            await cleanupUpload();
            releaseReservedResources();
            throw new BadRequestError("Invalid notify URL signature");
          }
        } else {
          request.log.warn(
            { notify: taskPayload.notify },
            "Received task without notify signature; signature will be required in future",
          );
        }
      }

      let mimeType: z.infer<typeof MimeTypeSchema>;
      try {
        mimeType = MimeTypeSchema.parse(uploadMimeType);
      } catch {
        await cleanupUpload();
        releaseReservedResources();
        throw new BadRequestError(
          `Unsupported file type: ${uploadMimeType}. Supported types: application/x-tar, application/zstd`,
        );
      }

      const resourceLimits: ResourceLimits = {
        memoryGB: taskPayload.memoryLimitGb ?? DEFAULT_MEMORY_GB,
        cpus: taskPayload.cpuLimit ?? DEFAULT_CPUS,
      };

      if (!tryResizeReservedResources(reservedLimits, resourceLimits)) {
        await cleanupUpload();
        releaseReservedResources();
        throw new SandboxBusyError();
      }
      reservedLimits = resourceLimits;

      if (taskPayload.submissionId) {
        request.log.info({ submissionId: taskPayload.submissionId }, "Handling submission");
      }

      const executionId = randomUUID();
      const notifyUrl = taskPayload.notify;
      const token = taskPayload.token;
      const log = request.log.child({
        executionId,
        ...(taskPayload.submissionId ? { submissionId: taskPayload.submissionId } : {}),
      });

      const capturedUploadTmpDir = uploadTmpDir;
      const capturedResourceLimits = reservedLimits;
      setImmediate(() => {
        void (async () => {
          let result: SubmissionResult | undefined;
          let executionError: unknown;
          try {
            result = await exec.executeSubmission(
              uploadPath,
              executionId,
              taskPayload.dockerImage,
              mimeType,
              resourceLimits,
            );
          } catch (error) {
            executionError = error;
            log.error({ error }, "Submission processing failed");
          } finally {
            // Release before notifying so the counter is accurate when the callback fires.
            releaseResources(capturedResourceLimits);
            // The executor unlinks the upload file; clean up the containing temp dir.
            try {
              await rm(capturedUploadTmpDir, { recursive: true, force: true });
            } catch {
              // temp dir may already be gone
            }
          }

          // Always notify the caller, even on internal failures.
          const payload = result
            ? {
                token,
                test_output: result.testOutput,
                stdout: result.stdout,
                stderr: result.stderr,
                valgrind: result.valgrind,
                validations: result.validations,
                vm_log: result.vmLog,
                status: result.status,
                exit_code: result.exitCode,
              }
            : {
                token,
                status: "failed" as const,
                error:
                  executionError instanceof Error ? executionError.message : String(executionError),
              };

          const controller = new AbortController();
          const fetchTimeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
          try {
            const response = await fetch(notifyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: controller.signal,
              redirect: "manual",
            });
            if (response.status >= 300 && response.status < 400) {
              throw new Error(`Redirects are not allowed for notify URL (HTTP ${response.status})`);
            }
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            log.info(
              { notifyUrl, status: result?.status ?? "failed" },
              "Notify callback succeeded",
            );
          } catch (error) {
            log.error({ notifyUrl, error }, "Notify callback failed");
          } finally {
            clearTimeout(fetchTimeout);
          }
        })();
      });

      return { message: "ok" };
    },
  );
}
