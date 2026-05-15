import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import * as resourceManager from "./services/resource-manager.js";

describe("Sandbox API Integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /status.json", () => {
    it("should return 200 with status data", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("busyInstances");
      expect(body).toHaveProperty("reservedCpuCores");
      expect(body).toHaveProperty("totalInstances");
      expect(body).toHaveProperty("reservedMemory");
      expect(body).toHaveProperty("totalMemory");
    });

    it("should return non-negative values", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      const body = JSON.parse(response.body);
      expect(body.busyInstances).toBeGreaterThanOrEqual(0);
      expect(body.reservedCpuCores).toBeGreaterThanOrEqual(0);
      expect(body.reservedMemory).toBeGreaterThanOrEqual(0);
      expect(body.totalInstances).toBeGreaterThan(0);
      expect(body.totalMemory).toBeGreaterThan(0);
    });

    it("should have reasonable system resource values", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      const body = JSON.parse(response.body);
      expect(body.totalInstances).toBeGreaterThan(0);
      expect(body.totalMemory).toBeGreaterThan(0);
    });

    it("should return consistent structure across multiple calls", async () => {
      const calls = await Promise.all([
        app.inject({ method: "GET", url: "/status.json" }),
        app.inject({ method: "GET", url: "/status.json" }),
        app.inject({ method: "GET", url: "/status.json" }),
      ]);

      const bodies = calls.map((r) => JSON.parse(r.body) as Record<string, unknown>);
      const keys = [
        "busyInstances",
        "reservedCpuCores",
        "totalInstances",
        "reservedMemory",
        "totalMemory",
      ];
      for (const body of bodies) {
        for (const key of keys) {
          expect(body).toHaveProperty(key);
        }
      }
    });

    it("should have content-type application/json", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      expect(response.headers["content-type"]).toContain("application/json");
    });
  });

  describe("POST /tasks.json error cases", () => {
    it("returns an error status when no multipart file is provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks.json",
        payload: "test",
      });

      // The multipart plugin rejects invalid content before our handler runs,
      // so the status may be 400 or 500 depending on the plugin version.
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("returns an error status for empty body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks.json",
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("always returns a JSON error body for bad requests", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks.json",
        payload: "test",
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body).toHaveProperty("error");
      expect(typeof body["error"]).toBe("string");
    });

    it("returns an error for malformed Content-Type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks.json",
        payload: "test",
        headers: {
          "content-type": "invalid/type",
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe("POST /tasks.json resource management", () => {
    beforeAll(() => {
      resourceManager.resetState();
    });

    afterAll(() => {
      resourceManager.resetState();
    });

    it("should not leak reserved resources after a failed request", async () => {
      const before = await app.inject({ method: "GET", url: "/status.json" });
      const beforeStatus = JSON.parse(before.body) as { busyInstances: number };

      await app.inject({
        method: "POST",
        url: "/tasks.json",
        payload: "invalid",
      });

      const after = await app.inject({ method: "GET", url: "/status.json" });
      const afterStatus = JSON.parse(after.body) as { busyInstances: number };

      expect(afterStatus.busyInstances).toBe(beforeStatus.busyInstances);
    });
  });

  describe("routing", () => {
    it("should have status endpoint", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 404 for unknown routes", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/unknown-endpoint",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 for POST to status endpoint", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/status.json",
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it("should accept only POST for tasks endpoint", async () => {
      const methods = ["GET", "PUT", "DELETE", "PATCH"] as const;
      const responses = await Promise.all(
        methods.map((method) => app.inject({ method, url: "/tasks.json" })),
      );
      for (const response of responses) {
        expect(response.statusCode).not.toBe(200);
      }
    });
  });

  describe("response format", () => {
    it("status response should have correct structure with correct types", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      const body = JSON.parse(response.body);
      const expectedKeys = [
        "busyInstances",
        "reservedCpuCores",
        "totalInstances",
        "reservedMemory",
        "totalMemory",
      ];

      for (const key of expectedKeys) {
        expect(body).toHaveProperty(key);
        expect(typeof body[key]).toBe("number");
      }
    });

    it("should not leak sensitive information in responses", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      const body = JSON.parse(response.body);
      const sensitiveKeys = ["password", "secret", "token", "credentials"];

      for (const key of sensitiveKeys) {
        expect(body).not.toHaveProperty(key);
      }
    });
  });

  describe("performance", () => {
    it("status endpoint should respond successfully", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle concurrent status requests", async () => {
      const requests = Array.from({ length: 10 }, () =>
        app.inject({
          method: "GET",
          url: "/status.json",
        }),
      );

      const responses = await Promise.all(requests);
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    });
  });

  describe("corner cases", () => {
    it("should return 404 for endpoint with trailing slash", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/status.json/",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should be case-sensitive for endpoints", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/Status.json",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should handle multiple consecutive requests", async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => app.inject({ method: "GET", url: "/status.json" })),
      );
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
      }
    });
  });
});
