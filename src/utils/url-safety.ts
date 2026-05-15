import { isIP } from "node:net";

// Private/reserved IP ranges and hostnames that must not be reachable as callback targets.
const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^127\./, // IPv4 loopback (127.0.0.0/8)
  /^::1$/, // IPv6 loopback
  /^0\./, // this-network (0.0.0.0/8)
  /^10\./, // RFC1918 (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 (172.16.0.0/12)
  /^192\.168\./, // RFC1918 (192.168.0.0/16)
  /^169\.254\./, // link-local + AWS/Azure metadata (169.254.0.0/16)
  /^fe80:/i, // IPv6 link-local (fe80::/10)
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique-local (fc00::/7)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (100.64.0.0/10, RFC6598)
  /^192\.0\.2\./, // TEST-NET-1 (RFC5737)
  /^198\.51\.100\./, // TEST-NET-2 (RFC5737)
  /^203\.0\.113\./, // TEST-NET-3 (RFC5737)
];

const BLOCKED_HOSTNAMES: Readonly<Set<string>> = new Set([
  "localhost", // always resolves to loopback
  "metadata.google.internal",
  "metadata.internal",
]);

// Specific metadata IPs not already covered by range patterns above.
const CLOUD_METADATA_IPS: Readonly<Set<string>> = new Set([
  "fd00:ec2::254", // AWS IPv6 metadata
]);

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/g, "");
}

function parseIpv4Address(hostname: string): number[] | undefined {
  const octets = hostname.split(".");
  if (octets.length !== 4) return undefined;

  const parsed = octets.map((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return Number.NaN;
    const value = Number(octet);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });

  return parsed.every((octet) => Number.isInteger(octet)) ? parsed : undefined;
}

function parseHextets(part: string): number[] | undefined {
  if (!part) return [];
  const hextets = part.split(":");
  const parsed = hextets.map((hextet) => {
    if (!/^[0-9a-f]{1,4}$/i.test(hextet)) return Number.NaN;
    return Number.parseInt(hextet, 16);
  });
  return parsed.every((hextet) => Number.isInteger(hextet)) ? parsed : undefined;
}

function parseIpv6Bytes(hostname: string): number[] | undefined {
  let address = hostname;

  if (address.includes(".")) {
    const lastColonIndex = address.lastIndexOf(":");
    if (lastColonIndex === -1) return undefined;

    const ipv4Bytes = parseIpv4Address(address.slice(lastColonIndex + 1));
    if (!ipv4Bytes) return undefined;

    const firstHextet = (ipv4Bytes[0]! << 8) + ipv4Bytes[1]!;
    const secondHextet = (ipv4Bytes[2]! << 8) + ipv4Bytes[3]!;
    address = `${address.slice(0, lastColonIndex)}:${firstHextet.toString(
      16,
    )}:${secondHextet.toString(16)}`;
  }

  const compressionParts = address.split("::");
  if (compressionParts.length > 2) return undefined;

  const left = parseHextets(compressionParts[0] ?? "");
  const right = parseHextets(compressionParts[1] ?? "");
  if (!left || !right) return undefined;

  const missingHextets = compressionParts.length === 2 ? 8 - left.length - right.length : 0;
  if (missingHextets < 0) return undefined;

  const hextets =
    compressionParts.length === 2
      ? [...left, ...Array.from({ length: missingHextets }, () => 0), ...right]
      : left;

  if (hextets.length !== 8) return undefined;

  return hextets.flatMap((hextet) => [(hextet >> 8) & 0xff, hextet & 0xff]);
}

function ipv4MappedAddress(hostname: string): string | undefined {
  const ipv6Bytes = parseIpv6Bytes(hostname);
  if (!ipv6Bytes) return undefined;

  const isMapped =
    ipv6Bytes.slice(0, 10).every((byte) => byte === 0) &&
    ipv6Bytes[10] === 0xff &&
    ipv6Bytes[11] === 0xff;

  if (!isMapped) return undefined;
  return ipv6Bytes.slice(12).join(".");
}

function isPrivateIpv6Address(hostname: string): boolean {
  const ipv6Bytes = parseIpv6Bytes(hostname);
  if (!ipv6Bytes) return false;

  const isUnspecified = ipv6Bytes.every((byte) => byte === 0);
  const isLoopback = ipv6Bytes.slice(0, 15).every((byte) => byte === 0) && ipv6Bytes[15] === 1;
  const isUniqueLocal = (ipv6Bytes[0]! & 0xfe) === 0xfc;
  const isLinkLocal = ipv6Bytes[0] === 0xfe && (ipv6Bytes[1]! & 0xc0) === 0x80;

  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal;
}

export function isPrivateOrMetadataUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  const hostname = normalizeHostname(url.hostname);

  if (BLOCKED_HOSTNAMES.has(hostname) || CLOUD_METADATA_IPS.has(hostname)) {
    return true;
  }

  const mappedIpv4Address = ipv4MappedAddress(hostname);
  if (mappedIpv4Address) {
    return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(mappedIpv4Address));
  }

  if (isIP(hostname) === 6 && isPrivateIpv6Address(hostname)) {
    return true;
  }

  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}
