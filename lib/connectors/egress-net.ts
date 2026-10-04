import dns from "node:dns";
import net from "node:net";

export type LookupAddress = { address: string; family: number };

export type ResolveFn = (
  hostname: string,
  options: { all: true },
) => Promise<LookupAddress[]>;

export const defaultResolve: ResolveFn = (hostname, options) =>
  dns.promises.lookup(hostname, options);

export type AddressVerdict = { blocked: false } | { blocked: true; reason: string };

const METADATA_V6_GROUPS = [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254];

function classifyIPv4(a: number, b: number, c: number, d: number): AddressVerdict {
  if (a === 169 && b === 254 && c === 169 && d === 254) {
    return { blocked: true, reason: "resolved to a cloud metadata address" };
  }
  if (a === 0) return { blocked: true, reason: "resolved to an unspecified address" };
  if (a === 127) return { blocked: true, reason: "resolved to a loopback address" };
  if (a === 10) return { blocked: true, reason: "resolved to a private address" };
  if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: "resolved to a private address" };
  if (a === 192 && b === 168) return { blocked: true, reason: "resolved to a private address" };
  if (a === 100 && b >= 64 && b <= 127) return { blocked: true, reason: "resolved to a private address" };
  if (a === 169 && b === 254) return { blocked: true, reason: "resolved to a link local address" };
  return { blocked: false };
}

function parseIPv4Parts(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function expandIPv6Groups(address: string): number[] | null {
  const raw = address.toLowerCase();
  const doubleColonIndex = raw.indexOf("::");

  function splitToGroups(section: string): string[] {
    return section.length ? section.split(":") : [];
  }

  function absorbEmbeddedIPv4(groups: string[]): string[] {
    const last = groups[groups.length - 1];
    if (!last || !last.includes(".")) return groups;
    const v4 = parseIPv4Parts(last);
    if (!v4) return groups;
    const withoutLast = groups.slice(0, -1);
    return [
      ...withoutLast,
      (((v4[0] << 8) | v4[1]) >>> 0).toString(16),
      (((v4[2] << 8) | v4[3]) >>> 0).toString(16),
    ];
  }

  let groups: string[];
  if (doubleColonIndex !== -1) {
    const left = splitToGroups(raw.slice(0, doubleColonIndex));
    const right = absorbEmbeddedIPv4(splitToGroups(raw.slice(doubleColonIndex + 2)));
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = absorbEmbeddedIPv4(splitToGroups(raw));
  }

  if (groups.length !== 8) return null;
  const values = groups.map((group) => parseInt(group || "0", 16));
  return values.some((value) => Number.isNaN(value)) ? null : values;
}

function classifyIPv6(groups: number[]): AddressVerdict {
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return classifyIPv4(a, b, c, d);
  }
  if (groups.every((value, index) => value === METADATA_V6_GROUPS[index])) {
    return { blocked: true, reason: "resolved to a cloud metadata address" };
  }
  if (groups.every((value) => value === 0)) {
    return { blocked: true, reason: "resolved to an unspecified address" };
  }
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1) {
    return { blocked: true, reason: "resolved to a loopback address" };
  }
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return { blocked: true, reason: "resolved to a unique local address" };
  }
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return { blocked: true, reason: "resolved to a link local address" };
  }
  return { blocked: false };
}

export function classifyAddress(address: string): AddressVerdict {
  const kind = net.isIP(address);
  if (kind === 4) {
    const parts = parseIPv4Parts(address);
    return parts ? classifyIPv4(...parts) : { blocked: true, reason: "address could not be parsed" };
  }
  if (kind === 6) {
    const groups = expandIPv6Groups(address);
    return groups ? classifyIPv6(groups) : { blocked: true, reason: "address could not be parsed" };
  }
  return { blocked: true, reason: "address could not be parsed" };
}

export function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isIpLiteralHost(hostname: string): boolean {
  return net.isIP(stripBrackets(hostname)) !== 0;
}

export function isLocalDevException(hostname: string): boolean {
  return process.env.NODE_ENV !== "production" && hostname === "localhost";
}
