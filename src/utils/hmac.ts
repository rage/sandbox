import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256_RE = /^[0-9a-fA-F]{64}$/;

// Verifies that `signature` is the hex-encoded HMAC-SHA256 of `message` under `secret`.
// Uses constant-time comparison to prevent timing attacks.
export function verifyHmacSha256(message: string, signature: string, secret: string): boolean {
  if (!HEX_SHA256_RE.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(message, "utf8").digest();
  const provided = Buffer.from(signature, "hex");
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}
