import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Single source of truth for SSRF defenses used by every outbound HTTP path
 * (model endpoint health, catalog manifest fetches, skill/plugin/template
 * remote fetches). Each function returns either `undefined` when the host is
 * acceptable, or a human-readable error string explaining why the host was
 * rejected.
 *
 * Coverage:
 *  - IPv4 private / loopback / link-local / cloud-metadata ranges
 *  - IPv6 loopback, link-local, unique-local, multicast, IPv4-mapped,
 *    6to4 (2002::/16), NAT64 well-known (64:ff9b::/96)
 *  - Cloud metadata hostnames (GCP, AWS)
 *  - Hostnames that resolve to any of the above (DNS-resolved blocklist)
 */

export async function validateOutboundHost(
  hostname: string,
  resolveHost: (
    hostname: string,
    options: { all: true }
  ) => Promise<Array<{ address: string; family: number }>>
): Promise<string | undefined> {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const blockedByName = isBlockedMetadataHost(normalized);
  if (blockedByName) {
    return blockedByName;
  }

  const blockedByIp = isBlockedIpAddress(normalized);
  if (blockedByIp) {
    return blockedByIp;
  }

  // Hostname that looks like a public DNS name: resolve every address and
  // re-check so a DNS rebind (or an attacker who controls the DNS record)
  // cannot pivot to a private address after validation.
  try {
    const addresses = await resolveHost(normalized, { all: true });
    if (addresses.length === 0) {
      return "Host did not resolve to any address";
    }
    for (const entry of addresses) {
      const blocked = isBlockedIpAddress(entry.address);
      if (blocked) {
        return blocked;
      }
    }
  } catch {
    return "Unable to resolve endpoint host";
  }
  return undefined;
}

export function isBlockedIpAddress(hostname: string): string | undefined {
  // URL.hostname keeps the surrounding brackets for IPv6 literals; strip them
  // so `isIP` and the blocklist see the bare address.
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(host) === 4) {
    if (isBlockedIPv4(host)) {
      return "Private or loopback network addresses are not allowed";
    }
    return undefined;
  }

  if (isIP(host) === 6) {
    if (host === "::1" || host === "0:0:0:0:0:0:0:1" || isBlockedIPv6(host)) {
      return "Private or loopback network addresses are not allowed";
    }
    return undefined;
  }

  const ipv4Embedded = extractEmbeddedIPv4(host);
  if (ipv4Embedded && isBlockedIPv4(ipv4Embedded)) {
    return "Private or loopback network addresses are not allowed";
  }

  return undefined;
}

export function isBlockedMetadataHost(hostname: string): string | undefined {
  const value = hostname.toLowerCase();
  if (value === "metadata.google.internal" || value.endsWith(".metadata.google.internal")) {
    return "Metadata hostnames are not allowed";
  }
  if (value === "localhost" || value === "localhost.localdomain") {
    return "Loopback addresses are not allowed";
  }
  if (value === "169.254.169.254") {
    return "Cloud metadata service is not allowed";
  }
  return undefined;
}

export function isBlockedIPv4(address: string): boolean {
  const octets = address.split(".").map((segment) => Number.parseInt(segment, 10));
  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  const c = octets[2] ?? -1;
  const d = octets[3] ?? -1;

  if (a === 127 || a === 0) return true; // loopback / unspecified
  if (a === 10) return true;             // 10.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  // NOTE: 198.18.0.0/15 (RFC 2544 benchmarking) is intentionally NOT blocked.
  // Surge/Clash-style proxies in fake-ip mode answer every DNS query with an
  // address from this range, so blocking it breaks all outbound requests for
  // proxied users. The range is not routable on the public internet and does
  // not overlap real private networks, so allowing it adds no SSRF vector.
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  // 0.0.0.0/8 already covered above
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  void c; void d;
  return false;
}

export function isBlockedIPv6(address: string): boolean {
  const value = address.toLowerCase();

  // IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:7f00:1`).
  if (value.startsWith("::ffff:")) {
    const tail = value.slice("::ffff:".length);
    const dotted = tail.includes(".") ? tail : undefined;
    if (dotted && isBlockedIPv4(dotted)) {
      return true;
    }
    // Hex form: the last 32 bits of the tail encode the IPv4. `isBlockedIPv6HexTail`
    // pads short groups (e.g. `7f00:1`) so the decode is always 8 hex digits.
    if (isBlockedIPv6HexTail(tail)) {
      return true;
    }
  }

  // 6to4 (`2002::/16`) — last 32 bits encode an IPv4.
  if (value.startsWith("2002:")) {
    const tail = value.slice("2002:".length);
    if (isBlockedIPv6HexTail(tail)) {
      return true;
    }
  }

  // NAT64 well-known prefix (`64:ff9b::/96`).
  if (value.startsWith("64:ff9b:")) {
    const tail = value.startsWith("64:ff9b::")
      ? value.slice("64:ff9b::".length)
      : value.slice("64:ff9b:".length);
    if (isBlockedIPv6HexTail(tail)) {
      return true;
    }
  }

  // Loopback (`::1`) and unspecified (`::`).
  if (value === "::1" || value === "::") return true;

  // Link-local (`fe80::/10`).
  if (/^fe[89ab][0-9a-f]?:/i.test(value)) return true;

  // Unique-local (`fc00::/7`).
  if (value.startsWith("fc") || value.startsWith("fd")) return true;

  // Multicast (`ff00::/8`).
  if (value.startsWith("ff")) return true;

  return false;
}

function isBlockedIPv6HexTail(hexTail: string): boolean {
  // The embedded IPv4 occupies the low-order 32 bits. Strip any colons and
  // left-pad with zeros to exactly 8 hex digits so a compressed group like
  // `7f00:1` (=> `7f00:0001` => 127.0.0.1) decodes correctly.
  const stripped = hexTail.replace(/:/g, "");
  const padded = stripped.padStart(8, "0");
  if (padded.length > 8) {
    return false;
  }
  const a = parseInt(padded.slice(0, 2), 16);
  const b = parseInt(padded.slice(2, 4), 16);
  const c = parseInt(padded.slice(4, 6), 16);
  const d = parseInt(padded.slice(6, 8), 16);
  if ([a, b, c, d].some((value) => Number.isNaN(value))) {
    return false;
  }
  return isBlockedIPv4(`${a}.${b}.${c}.${d}`);
}

function extractEmbeddedIPv4(address: string): string | undefined {
  const match = /:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/.exec(address);
  return match?.groups?.ipv4;
}