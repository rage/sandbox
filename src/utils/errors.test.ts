import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  SandboxBusyError,
  InternalServerError,
  handleError,
} from "./errors.js";

describe("Error Classes", () => {
  describe("BadRequestError", () => {
    it("should have 400 status code", () => {
      const error = new BadRequestError("Bad input");
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Bad input");
    });

    it("should be instanceof AppError", () => {
      const error = new BadRequestError("Test");
      expect(error instanceof AppError).toBe(true);
    });

    it("should have correct error name", () => {
      const error = new BadRequestError("Test");
      expect(error.name).toBe("BadRequestError");
    });
  });

  describe("UnauthorizedError", () => {
    it("should have 401 status code", () => {
      const error = new UnauthorizedError("No auth");
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe("No auth");
    });

    it("should use default message", () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe("Unauthorized");
    });
  });

  describe("ForbiddenError", () => {
    it("should have 403 status code", () => {
      const error = new ForbiddenError("Access denied");
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe("Access denied");
    });

    it("should use default message", () => {
      const error = new ForbiddenError();
      expect(error.message).toBe("Forbidden");
    });
  });

  describe("NotFoundError", () => {
    it("should have 404 status code", () => {
      const error = new NotFoundError("Not found");
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Not found");
    });

    it("should use default message", () => {
      const error = new NotFoundError();
      expect(error.message).toBe("Not found");
    });
  });

  describe("SandboxBusyError", () => {
    it("should have 503 status code", () => {
      const error = new SandboxBusyError("Too busy");
      expect(error.statusCode).toBe(503);
      expect(error.message).toBe("Too busy");
    });

    it("should use default busy message", () => {
      const error = new SandboxBusyError();
      expect(error.message).toContain("busy");
    });
  });

  describe("InternalServerError", () => {
    it("should have 500 status code", () => {
      const error = new InternalServerError("Oops");
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe("Oops");
    });

    it("should use default message", () => {
      const error = new InternalServerError();
      expect(error.message).toBe("Internal server error");
    });
  });

  describe("AppError base class", () => {
    it("should be an Error", () => {
      const error = new AppError(400, "Test");
      expect(error instanceof Error).toBe(true);
    });

    it("should capture stack trace", () => {
      const error = new AppError(400, "Test");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("AppError");
    });

    it("should have correct property access", () => {
      const error = new AppError(418, "I am a teapot");
      expect(error.statusCode).toBe(418);
      expect(error.message).toBe("I am a teapot");
    });
  });
});

describe("Error Handler", () => {
  let mockRequest: FastifyRequest;
  let mockReply: FastifyReply;

  beforeEach(() => {
    mockRequest = {
      log: {
        error: vi.fn(),
      },
    } as unknown as FastifyRequest;
    mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  });

  describe("AppError handling", () => {
    it("should handle BadRequestError", () => {
      const error = new BadRequestError("Invalid");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Invalid",
        statusCode: 400,
      });
    });

    it("should handle UnauthorizedError", () => {
      const error = new UnauthorizedError("No token");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "No token",
        statusCode: 401,
      });
    });

    it("should handle ForbiddenError", () => {
      const error = new ForbiddenError("Denied");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(403);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Denied",
        statusCode: 403,
      });
    });

    it("should handle NotFoundError", () => {
      const error = new NotFoundError("Resource");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Resource",
        statusCode: 404,
      });
    });

    it("should handle SandboxBusyError", () => {
      const error = new SandboxBusyError("Overloaded");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(503);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Overloaded",
        statusCode: 503,
      });
    });

    it("should handle InternalServerError", () => {
      const error = new InternalServerError("Crash");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Crash",
        statusCode: 500,
      });
    });

    it("should handle all status codes correctly", () => {
      const testCases = [
        { error: new BadRequestError(""), code: 400 },
        { error: new UnauthorizedError(""), code: 401 },
        { error: new ForbiddenError(""), code: 403 },
        { error: new NotFoundError(""), code: 404 },
        { error: new InternalServerError(""), code: 500 },
        { error: new SandboxBusyError(""), code: 503 },
      ];

      testCases.forEach(({ error, code }) => {
        mockReply.code = vi.fn().mockReturnThis();
        mockReply.send = vi.fn().mockReturnThis();
        handleError(error, mockRequest, mockReply);
        expect(mockReply.code).toHaveBeenCalledWith(code);
      });
    });
  });

  describe("Generic Error handling", () => {
    it("should handle standard Error", () => {
      const error = new Error("Something went wrong");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Internal server error",
        statusCode: 500,
      });
    });

    it("should log unexpected errors via request.log.error", () => {
      const error = new Error("Something went wrong");
      handleError(error, mockRequest, mockReply);

      expect(
        (mockRequest.log as unknown as { error: ReturnType<typeof vi.fn> }).error,
      ).toHaveBeenCalledWith({ error }, "Unexpected error");
    });

    it("should log unknown non-Error throws via request.log.error", () => {
      handleError("string error", mockRequest, mockReply);

      expect(
        (mockRequest.log as unknown as { error: ReturnType<typeof vi.fn> }).error,
      ).toHaveBeenCalledWith({ error: "string error" }, "Unknown non-Error thrown");
    });

    it("should handle TypeError", () => {
      const error = new TypeError("Cannot read property");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
    });

    it("should handle RangeError", () => {
      const error = new RangeError("Out of range");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
    });

    it("should handle SyntaxError", () => {
      const error = new SyntaxError("Invalid JSON");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
    });
  });

  describe("Unknown error handling", () => {
    it("should handle string error", () => {
      handleError("unexpected", mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Unknown error",
        statusCode: 500,
      });
    });

    it("should handle null error", () => {
      handleError(null, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Unknown error",
        statusCode: 500,
      });
    });

    it("should handle undefined error", () => {
      handleError(undefined, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
    });

    it("should handle object error", () => {
      handleError({ error: "Something" }, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Unknown error",
        statusCode: 500,
      });
    });

    it("should handle number error", () => {
      handleError(404, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
    });
  });

  describe("corner cases", () => {
    it("should handle empty error message", () => {
      const error = new BadRequestError("");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "",
        statusCode: 400,
      });
    });

    it("should handle very long error message", () => {
      const longMessage = "x".repeat(10_000);
      const error = new BadRequestError(longMessage);
      handleError(error, mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: longMessage,
        statusCode: 400,
      });
    });

    it("should handle special characters in message", () => {
      const error = new BadRequestError('Test "quotes" and <tags> & symbols');
      handleError(error, mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Test "quotes" and <tags> & symbols',
        statusCode: 400,
      });
    });

    it("should handle unicode characters in message", () => {
      const error = new BadRequestError("Error: 测试 🚀 ñ");
      handleError(error, mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Error: 测试 🚀 ñ",
        statusCode: 400,
      });
    });

    it("should handle multiline error message", () => {
      const multilineMessage = "Line 1\nLine 2\nLine 3";
      const error = new BadRequestError(multilineMessage);
      handleError(error, mockRequest, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        error: multilineMessage,
        statusCode: 400,
      });
    });

    it("should call methods in correct order", () => {
      const callOrder: string[] = [];
      mockReply.code = vi.fn(() => {
        callOrder.push("code");
        return mockReply;
      });
      mockReply.send = vi.fn(() => {
        callOrder.push("send");
        return mockReply;
      });

      const error = new BadRequestError("Test");
      handleError(error, mockRequest, mockReply);

      expect(callOrder).toStrictEqual(["code", "send"]);
    });
  });
});
