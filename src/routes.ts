import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Multipart } from "@fastify/multipart";
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
const NOTIFY_TIMEOUT_MS = 30_000;

/** Safely extract a text value from a multipart field entry. */
function fieldValue(field: Multipart | Multipart[] | undefined): string | undefined {
  if (!field || Array.isArray(field) || field.type !== "field") return undefined;
  return field.value as string;
}

export function registerRoutes(app: FastifyInstance, executor?: SandboxExecutor): void {
  // Read at registration time so tests can set the env var before building the app.
  // If set, callbacks without a valid HMAC-SHA256 signature will be warned (future: rejected).
  // TODO: Reject unsigned callbacks once all clients are updated to sign requests.
  const callbackSecret = process.env["SANDBOX_CALLBACK_SECRET"];
  const runtime: DockerRuntime = process.env["DOCKER_RUNTIME"] === "runsc" ? "runsc" : "runc";
  const exec = executor ?? new SandboxExecutor(app.log, { dockerRuntime: runtime });

  app.get<{ Reply: StatusResponse }>(
    "/status.json",
    (): StatusResponse => ({
      busyInstances: getBusyInstances(),
      reservedCpuCores: getReservedCpuCores(),
      totalInstances: TOTAL_CPU_CORES,
      reservedMemory: getReservedMemory(),
      totalMemory: TOTAL_MEMORY_GB,
    }),
  );

  app.post<{ Reply: TaskResponse }>(
    "/tasks.json",
    async (request: FastifyRequest, _reply: FastifyReply): Promise<TaskResponse> => {
      const data = await request.file();

      if (!data) {
        throw new BadRequestError("No file provided");
      }

      let taskPayload: z.infer<typeof TaskPayloadSchema>;
      try {
        taskPayload = TaskPayloadSchema.parse({
          submissionId: fieldValue(data.fields["submission_id"]),
          dockerImage: fieldValue(data.fields["docker_image"]),
          memoryLimitGb: data.fields["memory_limit_gb"]
            ? Number(fieldValue(data.fields["memory_limit_gb"]))
            : undefined,
          cpuLimit: data.fields["cpu_limit"]
            ? Number(fieldValue(data.fields["cpu_limit"]))
            : undefined,
          notify: fieldValue(data.fields["notify"]),
          token: fieldValue(data.fields["token"]),
          notifySignature: fieldValue(data.fields["notify_signature"]),
        });
      } catch (error) {
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
        mimeType = MimeTypeSchema.parse(data.mimetype);
      } catch {
        throw new BadRequestError(
          `Unsupported file type: ${data.mimetype}. Supported types: application/x-tar, application/zstd`,
        );
      }

      const resourceLimits: ResourceLimits = {
        memoryGB: taskPayload.memoryLimitGb ?? DEFAULT_MEMORY_GB,
        cpus: taskPayload.cpuLimit ?? DEFAULT_CPUS,
      };

      if (!tryReserveResources(resourceLimits)) {
        throw new SandboxBusyError();
      }

      // Save the multipart stream to a temp file. Release resources and clean up on failure.
      let uploadTmpDir = "";
      let uploadPath = "";
      try {
        uploadTmpDir = await mkdtemp(join(tmpdir(), "sandbox-upload-"));
        uploadPath = join(uploadTmpDir, `${randomUUID()}.upload`);
        await pipeline(data.file, createWriteStream(uploadPath));
      } catch (error) {
        releaseResources(resourceLimits);
        if (uploadTmpDir) await rm(uploadTmpDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }

      if (taskPayload.submissionId) {
        request.log.info(`Handling submission ${taskPayload.submissionId}`);
      }

      const submissionId = taskPayload.submissionId ?? randomUUID();
      const notifyUrl = taskPayload.notify;
      const token = taskPayload.token;

      const capturedUploadTmpDir = uploadTmpDir;
      setImmediate(async () => {
        let result: SubmissionResult | undefined;
        let executionError: unknown;
        try {
          result = await exec.executeSubmission(
            uploadPath,
            submissionId,
            taskPayload.dockerImage,
            mimeType,
            resourceLimits,
          );
        } catch (error) {
          executionError = error;
          request.log.error({ error }, "Submission processing failed");
        } finally {
          // Release before notifying so the counter is accurate when the callback fires.
          releaseResources(resourceLimits);
          // The executor unlinks the upload file; clean up the containing temp dir.
          await rm(capturedUploadTmpDir, { recursive: true, force: true }).catch(() => {});
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
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          request.log.info(`Notified ${notifyUrl} with status ${result?.status ?? "failed"}`);
        } catch (error) {
          request.log.error({ error }, `Failed to notify ${notifyUrl}`);
        } finally {
          clearTimeout(fetchTimeout);
        }
      });

      return { message: "ok" };
    },
  );
}
