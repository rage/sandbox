import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256 } from "./hmac.js";

function sign(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

describe("verifyHmacSha256", () => {
  const secret = "test-secret-key";
  const message = "https://example.com/callback";

  it("returns true for a valid signature", () => {
    const signature = sign(message, secret);
    expect(verifyHmacSha256(message, signature, secret)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const signature = sign(message, secret);
    expect(verifyHmacSha256(message, signature, "wrong-secret")).toBe(false);
  });

  it("returns false for tampered message", () => {
    const signature = sign(message, secret);
    expect(verifyHmacSha256("https://evil.com/callback", signature, secret)).toBe(false);
  });

  it("returns false for tampered signature", () => {
    const signature = sign(message, secret);
    const tampered = signature.slice(0, -2) + "00";
    expect(verifyHmacSha256(message, tampered, secret)).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyHmacSha256(message, "", secret)).toBe(false);
  });

  it("returns false for non-hex signature", () => {
    expect(verifyHmacSha256(message, "not-hex-at-all!!", secret)).toBe(false);
  });

  it("returns false for valid-length string with non-hex characters", () => {
    // 64 chars, right length for SHA-256 hex, but 'g' is not a hex digit
    expect(verifyHmacSha256(message, "g".repeat(64), secret)).toBe(false);
  });

  it("returns false for signature of wrong length", () => {
    const truncated = sign(message, secret).slice(0, 32);
    expect(verifyHmacSha256(message, truncated, secret)).toBe(false);
  });

  it("is case-insensitive on hex digits (both produce same bytes)", () => {
    const signatureLower = sign(message, secret).toLowerCase();
    const signatureUpper = sign(message, secret).toUpperCase();
    expect(verifyHmacSha256(message, signatureLower, secret)).toBe(true);
    expect(verifyHmacSha256(message, signatureUpper, secret)).toBe(true);
  });

  it("works with unicode message content", () => {
    const unicodeMessage = "https://example.com/callback?user=测试";
    const signature = sign(unicodeMessage, secret);
    expect(verifyHmacSha256(unicodeMessage, signature, secret)).toBe(true);
  });
});
