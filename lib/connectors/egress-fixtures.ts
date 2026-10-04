import { vi } from "vitest";

const ADDRESSES: Record<string, string[]> = {
  "api.example.com": ["93.184.216.34"],
  "other.example.com": ["93.184.216.35"],
  "approved.example.com": ["93.184.216.36"],
  "v6.example.com": ["2606:4700::1111"],
  "internal.example.com": ["10.0.0.5"],
  "corp.example.com": ["192.168.1.7"],
  "docker.example.com": ["172.17.0.2"],
  "cgnat.example.com": ["100.64.0.9"],
  "loop.example.com": ["127.0.0.1"],
  "link.example.com": ["169.254.10.10"],
  "meta.example.com": ["169.254.169.254"],
  "ula.example.com": ["fd12:3456::1"],
  "v6link.example.com": ["fe80::1"],
  "v6loop.example.com": ["::1"],
  "unspec.example.com": ["0.0.0.0"],
  "unspec-block.example.com": ["0.1.2.3"],
  "v6unspec.example.com": ["::"],
  "awsmeta.example.com": ["fd00:ec2::254"],
  "mapped.example.com": ["::ffff:169.254.169.254"],
  "mixed.example.com": ["93.184.216.34", "192.168.1.7"],
  "empty.example.com": [],
  localhost: ["127.0.0.1"],
};

export function createResolve() {
  return vi.fn(async (hostname: string) => {
    const addresses = ADDRESSES[hostname];
    if (!addresses) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
}

export function reasonOf(result: { ok: true } | { ok: false; reason: string }): string {
  return result.ok ? "" : result.reason;
}

export function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

export function responder(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (input) => {
    const key = input.toString();
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`no stub for ${key}`);
    return route();
  });
  return { impl, calls };
}
