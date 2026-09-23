/**
 * SSRF address guard shared by webhook admission (/webhooks server action)
 * and delivery (lib/webhooks.ts).
 *
 * Regex lists missed IPv4-mapped IPv6 answers (`::ffff:127.0.0.1`, which the
 * URL parser canonicalises to `::ffff:7f00:1`), bracketed IPv6 hostnames,
 * 0.0.0.0/8 benchmarking / multicast / reserved ranges and NAT64. Addresses
 * are normalised first and then checked against a node:net BlockList.
 */
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 → embeds an IPv4 target
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001:db8::", 32],
  ["fc00::", 7], // ULA
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Strip brackets / zone ids and unwrap IPv4-mapped IPv6 to dotted IPv4. */
export function normaliseIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return ip;
  const h = expandV6(ip);
  if (!h) return ip;
  // ::ffff:a.b.c.d (mapped) and the deprecated ::a.b.c.d (compatible) both
  // reach an IPv4 target; `::` and `::1` stay IPv6.
  const mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
  const compatible = h.slice(0, 6).every((x) => x === 0) && (h[6] !== 0 || h[7] > 1);
  if (mapped || compatible) {
    return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  }
  return ip;
}

function expandV6(ip: string): number[] | null {
  let s = ip;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  const nums = parts.map((p) => parseInt(p, 16));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

/** True for any address a webhook must never reach. Unparseable → blocked. */
export function isPrivateIp(raw: string): boolean {
  const ip = normaliseIp(raw);
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) return blocked.check(ip, "ipv6");
  return true;
}

const PRIVATE_NAME = /^(localhost|localhost\.localdomain)$|\.(localhost|internal|local|home|lan)$/i;

/**
 * Admission check on a URL hostname. Literal IPs (bracketed or not) go
 * through isPrivateIp; names are refused only for internal-looking suffixes
 * here — delivery re-checks every resolved address.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (isIP(normaliseIp(bare))) return isPrivateIp(bare);
  return PRIVATE_NAME.test(bare);
}
