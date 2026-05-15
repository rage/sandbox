import { describe, it, expect } from "vitest";
import {
  ResourceLimitsSchema,
  TaskPayloadSchema,
  MimeTypeSchema,
  StatusResponseSchema,
  TaskResponseSchema,
  ErrorResponseSchema,
} from "./schemas.js";

describe("Schemas", () => {
  describe("ResourceLimitsSchema", () => {
    it("should validate valid resource limits", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 2,
        cpus: 1.5,
      });
      expect(result.success).toBe(true);
    });

    it("should accept minimum memory (0.5GB)", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 0.5,
        cpus: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should accept maximum memory (4GB)", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 4,
        cpus: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should reject memory below minimum", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 0.4,
        cpus: 1,
      });
      expect(result.success).toBe(false);
    });

    it("should reject memory above maximum", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 5,
        cpus: 1,
      });
      expect(result.success).toBe(false);
    });

    it("should accept minimum CPU (0.1)", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 1,
        cpus: 0.1,
      });
      expect(result.success).toBe(true);
    });

    it("should accept maximum CPU (2)", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 1,
        cpus: 2,
      });
      expect(result.success).toBe(true);
    });

    it("should reject CPU below minimum", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 1,
        cpus: 0.05,
      });
      expect(result.success).toBe(false);
    });

    it("should reject CPU above maximum", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 1,
        cpus: 3,
      });
      expect(result.success).toBe(false);
    });

    it("should reject zero memory", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 0,
        cpus: 1,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative resources", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: -1,
        cpus: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TaskPayloadSchema", () => {
    const validPayload = {
      notify: "http://example.com/notify",
      token: "secret-token",
    };

    it("should validate minimum required fields", () => {
      const result = TaskPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept optional submission ID", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        submissionId: "sub-123",
      });
      expect(result.success).toBe(true);
    });

    it("should accept empty optional submission ID", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        submissionId: undefined,
      });
      expect(result.success).toBe(true);
    });

    it("should accept whitelisted docker image (GCR prefix)", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        dockerImage: "eu.gcr.io/moocfi-public/tmc-sandbox-v1",
      });
      expect(result.success).toBe(true);
    });

    it("should accept whitelisted alternative docker image", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        dockerImage: "nygrenh/sandbox-next",
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-whitelisted docker image", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        dockerImage: "untrusted/image:latest",
      });
      expect(result.success).toBe(false);
    });

    it("should reject docker image with wrong GCR prefix", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        dockerImage: "us.gcr.io/moocfi-public/tmc-sandbox-v1",
      });
      expect(result.success).toBe(false);
    });

    it("should require valid notify URL", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        notify: "not-a-url",
      });
      expect(result.success).toBe(false);
    });

    it("should accept HTTPS notify URL", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        notify: "https://secure.example.com/api/notify",
      });
      expect(result.success).toBe(true);
    });

    it("should require token", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        token: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only token", () => {
      const result = TaskPayloadSchema.safeParse({
        notify: validPayload.notify,
        token: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("should accept custom memory limit (max 4GB)", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        memoryLimitGb: 4,
      });
      expect(result.success).toBe(true);
    });

    it("should reject memory limit above maximum (4GB)", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        memoryLimitGb: 999,
      });
      expect(result.success).toBe(false);
    });

    it("should accept custom CPU limit (max 2)", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        cpuLimit: 2,
      });
      expect(result.success).toBe(true);
    });

    it("should reject CPU limit above maximum (2)", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        cpuLimit: 99,
      });
      expect(result.success).toBe(false);
    });

    it("should reject loopback notify URL (SSRF)", () => {
      const ssrfUrls = [
        "http://127.0.0.1/callback",
        "http://localhost/callback",
        "http://0.0.0.0/callback",
        "http://[::1]/callback",
      ];
      for (const url of ssrfUrls) {
        const result = TaskPayloadSchema.safeParse({ ...validPayload, notify: url });
        expect(result.success).toBe(false);
      }
    });

    it("should reject RFC1918 notify URLs (SSRF)", () => {
      const privateUrls = [
        "http://10.0.0.1/callback",
        "http://172.16.0.1/callback",
        "http://192.168.1.1/callback",
      ];
      for (const url of privateUrls) {
        const result = TaskPayloadSchema.safeParse({ ...validPayload, notify: url });
        expect(result.success).toBe(false);
      }
    });

    it("should reject cloud metadata notify URLs (SSRF)", () => {
      const metadataUrls = [
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
      ];
      for (const url of metadataUrls) {
        const result = TaskPayloadSchema.safeParse({ ...validPayload, notify: url });
        expect(result.success).toBe(false);
      }
    });

    it("should accept optional notifySignature", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        notifySignature: "abc123def456",
      });
      expect(result.success).toBe(true);
    });

    it("should accept fractional CPU limit", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        cpuLimit: 0.5,
      });
      expect(result.success).toBe(true);
    });

    it("should accept all optional fields together", () => {
      const result = TaskPayloadSchema.safeParse({
        submissionId: "sub-456",
        dockerImage: "eu.gcr.io/moocfi-public/tmc-sandbox-v2",
        memoryLimitGb: 2,
        cpuLimit: 1.5,
        notify: "https://api.example.com/submissions",
        token: "long-random-token-abc123xyz",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid notify URL formats", () => {
      const invalidUrls = ["example.com", "://invalid"];
      invalidUrls.forEach((url) => {
        const result = TaskPayloadSchema.safeParse({
          ...validPayload,
          notify: url,
        });
        expect(result.success).toBe(false);
      });
    });

    it("should reject submissionId with disallowed characters (dots, spaces, slashes)", () => {
      const invalid = ["sub.123", "sub 123", "sub/123", "sub@123", "sub#id"];
      for (const id of invalid) {
        const result = TaskPayloadSchema.safeParse({ ...validPayload, submissionId: id });
        expect(result.success, `expected "${id}" to be rejected`).toBe(false);
      }
    });

    it("should reject empty submissionId", () => {
      const result = TaskPayloadSchema.safeParse({ ...validPayload, submissionId: "" });
      expect(result.success).toBe(false);
    });

    it("should accept submissionId at the 128-character maximum", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        submissionId: "a".repeat(128),
      });
      expect(result.success).toBe(true);
    });

    it("should reject submissionId exceeding 128 characters", () => {
      const result = TaskPayloadSchema.safeParse({
        ...validPayload,
        submissionId: "a".repeat(129),
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty string dockerImage (not the same as omitting the field)", () => {
      const result = TaskPayloadSchema.safeParse({ ...validPayload, dockerImage: "" });
      expect(result.success).toBe(false);
    });

    it("SANDBOX_DISABLE_SSRF_CHECK allows private notify URLs when set", () => {
      const original = process.env["SANDBOX_DISABLE_SSRF_CHECK"];
      try {
        process.env["SANDBOX_DISABLE_SSRF_CHECK"] = "true";
        const result = TaskPayloadSchema.safeParse({
          ...validPayload,
          notify: "http://127.0.0.1/callback",
        });
        expect(result.success).toBe(true);
      } finally {
        if (original === undefined) {
          delete process.env["SANDBOX_DISABLE_SSRF_CHECK"];
        } else {
          process.env["SANDBOX_DISABLE_SSRF_CHECK"] = original;
        }
      }
    });
  });

  describe("MimeTypeSchema", () => {
    it("should accept tar mime type", () => {
      const result = MimeTypeSchema.safeParse("application/x-tar");
      expect(result.success).toBe(true);
    });

    it("should accept zstd mime type", () => {
      const result = MimeTypeSchema.safeParse("application/zstd");
      expect(result.success).toBe(true);
    });

    it("should reject unsupported mime types", () => {
      const unsupported = [
        "application/zip",
        "application/gzip",
        "application/json",
        "text/plain",
        "application/x-tar-gz",
      ];
      unsupported.forEach((mime) => {
        const result = MimeTypeSchema.safeParse(mime);
        expect(result.success).toBe(false);
      });
    });

    it("should reject empty string", () => {
      const result = MimeTypeSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("should reject case-sensitive mime types", () => {
      const result = MimeTypeSchema.safeParse("Application/X-TAR");
      expect(result.success).toBe(false);
    });
  });

  describe("StatusResponseSchema", () => {
    it("should validate complete status response", () => {
      const result = StatusResponseSchema.safeParse({
        busy_instances: 2,
        reserved_cpu_cores: 2,
        total_instances: 8,
        reserved_memory: 4,
        total_memory: 16,
      });
      expect(result.success).toBe(true);
    });

    it("should validate zero values", () => {
      const result = StatusResponseSchema.safeParse({
        busy_instances: 0,
        reserved_cpu_cores: 0,
        total_instances: 0,
        reserved_memory: 0,
        total_memory: 0,
      });
      expect(result.success).toBe(true);
    });

    it("should validate floating point values", () => {
      const result = StatusResponseSchema.safeParse({
        busy_instances: 1.5,
        reserved_cpu_cores: 1.5,
        total_instances: 8.5,
        reserved_memory: 4.25,
        total_memory: 16.75,
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing fields", () => {
      const result = StatusResponseSchema.safeParse({
        busy_instances: 2,
        reserved_cpu_cores: 2,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-numeric values", () => {
      const result = StatusResponseSchema.safeParse({
        busy_instances: "2",
        reserved_cpu_cores: "2",
        total_instances: 8,
        reserved_memory: 4,
        total_memory: 16,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TaskResponseSchema", () => {
    it("should validate success response", () => {
      const result = TaskResponseSchema.safeParse({
        message: "ok",
      });
      expect(result.success).toBe(true);
    });

    it("should accept any non-empty message", () => {
      const result = TaskResponseSchema.safeParse({
        message: "Request accepted and queued for processing",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing message", () => {
      const result = TaskResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject non-string message", () => {
      const result = TaskResponseSchema.safeParse({
        message: 123,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ErrorResponseSchema", () => {
    it("should validate error response with 400 status", () => {
      const result = ErrorResponseSchema.safeParse({
        error: "Invalid input",
        statusCode: 400,
      });
      expect(result.success).toBe(true);
    });

    it("should validate error response with 500 status", () => {
      const result = ErrorResponseSchema.safeParse({
        error: "Internal server error",
        statusCode: 500,
      });
      expect(result.success).toBe(true);
    });

    it("should validate error response with 503 status", () => {
      const result = ErrorResponseSchema.safeParse({
        error: "Service unavailable",
        statusCode: 503,
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-numeric status code", () => {
      const result = ErrorResponseSchema.safeParse({
        error: "Error",
        statusCode: "400",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing error message", () => {
      const result = ErrorResponseSchema.safeParse({
        statusCode: 400,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("corner cases", () => {
    it("should handle very long strings", () => {
      const longString = "x".repeat(10_000);
      const result = TaskPayloadSchema.safeParse({
        notify: "http://example.com/notify",
        token: longString,
      });
      expect(result.success).toBe(true);
    });

    it("should handle URLs with complex query strings", () => {
      const result = TaskPayloadSchema.safeParse({
        notify: "http://example.com/notify?key1=value1&key2=value2&callback=true",
        token: "token123",
      });
      expect(result.success).toBe(true);
    });

    it("should handle URLs with authentication", () => {
      const result = TaskPayloadSchema.safeParse({
        notify: "https://user:pass@example.com/notify",
        token: "token123",
      });
      expect(result.success).toBe(true);
    });

    it("should handle URLs with ports", () => {
      const result = TaskPayloadSchema.safeParse({
        notify: "http://example.com:8080/notify",
        token: "token123",
      });
      expect(result.success).toBe(true);
    });

    it("should handle very large resource limits", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 4,
        cpus: 2,
      });
      expect(result.success).toBe(true);
    });

    it("should handle very small resource limits", () => {
      const result = ResourceLimitsSchema.safeParse({
        memoryGB: 0.5,
        cpus: 0.1,
      });
      expect(result.success).toBe(true);
    });
  });
});
