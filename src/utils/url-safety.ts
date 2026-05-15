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

export function isPrivateOrMetadataUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  // Strip IPv6 brackets before pattern matching.
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname) || CLOUD_METADATA_IPS.has(hostname)) {
    return true;
  }

  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}
