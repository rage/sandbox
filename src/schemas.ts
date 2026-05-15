import { z } from "zod";
import { isPrivateOrMetadataUrl } from "./utils/url-safety.js";

const MAX_MEMORY_REQUEST_GB = 4;
const MAX_CPUS_REQUEST = 2;
export const ALLOWED_DOCKER_IMAGE_PREFIX = "eu.gcr.io/moocfi-public/tmc-sandbox-";
export const ALLOWED_ALTERNATIVE_DOCKER_IMAGES: ReadonlySet<string> = new Set([
  "nygrenh/sandbox-next",
]);

export const ResourceLimitsSchema = z.object({
  memoryGB: z.number().min(0.5).max(MAX_MEMORY_REQUEST_GB),
  cpus: z.number().min(0.1).max(MAX_CPUS_REQUEST),
});

export const TaskPayloadSchema = z.object({
  submissionId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(128, "Submission ID must be at most 128 characters")
    .optional(),
  dockerImage: z
    .string()
    .optional()
    .refine(
      (val) =>
        val === undefined ||
        val.startsWith(ALLOWED_DOCKER_IMAGE_PREFIX) ||
        ALLOWED_ALTERNATIVE_DOCKER_IMAGES.has(val),
      "Docker image was not whitelisted",
    ),
  memoryLimitGb: z.number().min(0.5).max(MAX_MEMORY_REQUEST_GB).optional(),
  cpuLimit: z.number().min(0.1).max(MAX_CPUS_REQUEST).optional(),
  notify: z
    .string()
    .url("Notify URL must be valid")
    .refine(
      // Check is evaluated lazily at parse time so SANDBOX_DISABLE_SSRF_CHECK
      // can be set after module load (e.g., in test setup).
      (url) => process.env["SANDBOX_DISABLE_SSRF_CHECK"] === "true" || !isPrivateOrMetadataUrl(url),
      "Notify URL must not target private or internal addresses",
    ),
  token: z.string().trim().min(1, "Token must not be empty or whitespace-only"),
  // Experimental: HMAC-SHA256 signature (hex) over the notify URL value.
  // TODO: Make this required once all clients are updated to sign callbacks.
  notifySignature: z.string().optional(),
});

export const MimeTypeSchema = z.enum(["application/x-tar", "application/zstd"]);

export const StatusResponseSchema = z.object({
  busy_instances: z.number(),
  reserved_cpu_cores: z.number(),
  total_instances: z.number(),
  reserved_memory: z.number(),
  total_memory: z.number(),
});

export const TaskResponseSchema = z.object({
  message: z.string(),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  statusCode: z.number(),
});
