import { describe, it, expect } from "vitest";
import { isPrivateOrMetadataUrl } from "./url-safety.js";

describe("isPrivateOrMetadataUrl", () => {
  describe("public URLs (should return false)", () => {
    it("allows regular public HTTPS URL", () => {
      expect(isPrivateOrMetadataUrl("https://example.com/callback")).toBe(false);
    });

    it("allows public IP URL", () => {
      expect(isPrivateOrMetadataUrl("https://8.8.8.8/callback")).toBe(false);
    });

    it("allows public URL with port", () => {
      expect(isPrivateOrMetadataUrl("https://example.com:8080/callback")).toBe(false);
    });

    it("allows public URL with path and query", () => {
      expect(isPrivateOrMetadataUrl("https://api.example.com/v1/notify?token=abc")).toBe(false);
    });

    it("returns false for an unparseable string (no URL)", () => {
      expect(isPrivateOrMetadataUrl("not-a-url")).toBe(false);
    });
  });

  describe("loopback addresses (should return true)", () => {
    it("blocks 127.0.0.1", () => {
      expect(isPrivateOrMetadataUrl("http://127.0.0.1/")).toBe(true);
    });

    it("blocks 127.x.x.x range", () => {
      expect(isPrivateOrMetadataUrl("http://127.255.255.255/")).toBe(true);
    });

    it("blocks IPv6 loopback ::1", () => {
      expect(isPrivateOrMetadataUrl("http://[::1]/")).toBe(true);
    });

    it("blocks 0.0.0.0", () => {
      expect(isPrivateOrMetadataUrl("http://0.0.0.0/")).toBe(true);
    });

    it("blocks localhost hostname", () => {
      expect(isPrivateOrMetadataUrl("http://localhost/callback")).toBe(true);
    });

    it("blocks localhost with port", () => {
      expect(isPrivateOrMetadataUrl("http://localhost:8080/callback")).toBe(true);
    });

    it("blocks localhost with a trailing DNS dot", () => {
      expect(isPrivateOrMetadataUrl("http://localhost./callback")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 loopback addresses", () => {
      expect(isPrivateOrMetadataUrl("http://[::ffff:7f00:1]/callback")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 private addresses", () => {
      expect(isPrivateOrMetadataUrl("http://[::ffff:c0a8:101]/callback")).toBe(true);
    });

    it("allows IPv4-mapped IPv6 public addresses", () => {
      expect(isPrivateOrMetadataUrl("http://[::ffff:808:808]/callback")).toBe(false);
    });
  });

  describe("RFC1918 private ranges (should return true)", () => {
    it("blocks 10.x.x.x", () => {
      expect(isPrivateOrMetadataUrl("http://10.0.0.1/callback")).toBe(true);
    });

    it("blocks 172.16.x.x", () => {
      expect(isPrivateOrMetadataUrl("http://172.16.0.1/callback")).toBe(true);
    });

    it("blocks 172.31.x.x", () => {
      expect(isPrivateOrMetadataUrl("http://172.31.255.254/callback")).toBe(true);
    });

    it("allows 172.15.x.x (just outside RFC1918 range)", () => {
      expect(isPrivateOrMetadataUrl("http://172.15.0.1/callback")).toBe(false);
    });

    it("allows 172.32.x.x (just outside RFC1918 range)", () => {
      expect(isPrivateOrMetadataUrl("http://172.32.0.1/callback")).toBe(false);
    });

    it("blocks 192.168.x.x", () => {
      expect(isPrivateOrMetadataUrl("http://192.168.1.100/callback")).toBe(true);
    });
  });

  describe("link-local and cloud metadata (should return true)", () => {
    it("blocks 169.254.x.x (link-local)", () => {
      expect(isPrivateOrMetadataUrl("http://169.254.0.1/")).toBe(true);
    });

    it("blocks AWS metadata IP 169.254.169.254", () => {
      expect(isPrivateOrMetadataUrl("http://169.254.169.254/latest/meta-data/")).toBe(true);
    });

    it("blocks metadata.google.internal", () => {
      expect(isPrivateOrMetadataUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(
        true,
      );
    });

    it("blocks metadata.internal", () => {
      expect(isPrivateOrMetadataUrl("http://metadata.internal/")).toBe(true);
    });

    it("blocks AWS IPv6 metadata fd00:ec2::254", () => {
      expect(isPrivateOrMetadataUrl("http://[fd00:ec2::254]/latest/meta-data/")).toBe(true);
    });
  });

  describe("IPv6 unique-local (should return true)", () => {
    it("blocks fc00::/7 unique-local addresses", () => {
      expect(isPrivateOrMetadataUrl("http://[fc00::1]/")).toBe(true);
    });

    it("blocks fd00::/8 unique-local addresses", () => {
      expect(isPrivateOrMetadataUrl("http://[fd12:3456:789a::1]/")).toBe(true);
    });

    it("blocks IPv6 link-local fe80::", () => {
      expect(isPrivateOrMetadataUrl("http://[fe80::1]/")).toBe(true);
    });
  });

  describe("CGNAT range (should return true)", () => {
    it("blocks 100.64.0.0 (CGNAT start)", () => {
      expect(isPrivateOrMetadataUrl("http://100.64.0.1/")).toBe(true);
    });

    it("blocks 100.127.255.255 (CGNAT end)", () => {
      expect(isPrivateOrMetadataUrl("http://100.127.255.254/")).toBe(true);
    });

    it("allows 100.128.0.1 (outside CGNAT)", () => {
      expect(isPrivateOrMetadataUrl("http://100.128.0.1/")).toBe(false);
    });
  });

  describe("case insensitivity for hostnames", () => {
    it("blocks mixed-case cloud metadata hostname", () => {
      expect(isPrivateOrMetadataUrl("http://Metadata.Google.Internal/")).toBe(true);
    });
  });
});
