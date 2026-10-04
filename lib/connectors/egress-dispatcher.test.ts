import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinnedDispatcher, createPinnedLookup } from "./egress-dispatcher";
import type { ResolveFn } from "./egress-net";

type LookupResult = { error: Error | null; address?: string | { address: string; family: number }[]; family?: number };

function invokeLookup(
  lookup: ReturnType<typeof createPinnedLookup>,
  hostname: string,
  options: { all?: boolean } = { all: true },
): Promise<LookupResult> {
  return new Promise((resolvePromise) => {
    lookup(hostname, options, (error, address, family) => resolvePromise({ error, address, family }));
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPinnedLookup", () => {
  it("blocks a later dns answer that rebinds to a cloud metadata address", async () => {
    let call = 0;
    const resolve = vi.fn(async () => {
      call += 1;
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }];
    });
    const lookup = createPinnedLookup(resolve);

    const first = await invokeLookup(lookup, "api.example.com");
    expect(first.error).toBeNull();

    const second = await invokeLookup(lookup, "api.example.com");
    expect(second.error).toBeInstanceOf(Error);
    expect((second.error as Error).message).toContain("metadata");
  });

  it("blocks a rebind to a private address on a hostname that already passed once", async () => {
    let call = 0;
    const resolve = vi.fn(async () => {
      call += 1;
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "10.0.0.5", family: 4 }];
    });
    const lookup = createPinnedLookup(resolve);

    await invokeLookup(lookup, "api.example.com");
    const second = await invokeLookup(lookup, "api.example.com");

    expect(second.error).toBeInstanceOf(Error);
    expect((second.error as Error).message).toContain("private");
  });

  it("blocks a rebind to the ipv4 unspecified address", async () => {
    let call = 0;
    const resolve = vi.fn(async () => {
      call += 1;
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "0.0.0.0", family: 4 }];
    });
    const lookup = createPinnedLookup(resolve);

    await invokeLookup(lookup, "api.example.com");
    const second = await invokeLookup(lookup, "api.example.com");

    expect(second.error).toBeInstanceOf(Error);
    expect((second.error as Error).message).toContain("unspecified");
  });

  it("blocks a rebind to the ipv6 unspecified address", async () => {
    let call = 0;
    const resolve = vi.fn(async () => {
      call += 1;
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "::", family: 6 }];
    });
    const lookup = createPinnedLookup(resolve);

    await invokeLookup(lookup, "api.example.com");
    const second = await invokeLookup(lookup, "api.example.com");

    expect(second.error).toBeInstanceOf(Error);
    expect((second.error as Error).message).toContain("unspecified");
  });

  it("refuses when the resolver returns no addresses at all", async () => {
    const resolve = vi.fn(async () => []);
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "empty.example.com");

    expect(result.error).toBeInstanceOf(Error);
  });

  it("returns a scrubbable error rather than throwing when the resolver rejects", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("resolver exploded");
    });
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "api.example.com");

    expect(result.error).toBeInstanceOf(Error);
  });

  it("routes a synchronously throwing resolver to the callback instead of leaking the throw", async () => {
    const resolve: ResolveFn = vi.fn(() => {
      throw new Error("resolver exploded synchronously");
    });
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "api.example.com");

    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("resolver exploded synchronously");
  });

  it("allows a loopback answer for the literal localhost hostname outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const resolve = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "localhost");

    expect(result.error).toBeNull();
  });

  it("blocks a loopback answer for the literal localhost hostname in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const resolve = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "localhost");

    expect(result.error).toBeInstanceOf(Error);
  });

  it("returns a single address and family when options.all is not set", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const lookup = createPinnedLookup(resolve);

    const result = await invokeLookup(lookup, "api.example.com", {});

    expect(result).toEqual({ error: null, address: "93.184.216.34", family: 4 });
  });
});

describe("createPinnedDispatcher", () => {
  it("builds a dispatcher that can be closed without throwing", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const dispatcher = createPinnedDispatcher(resolve);

    await expect(dispatcher.close()).resolves.not.toBeInstanceOf(Error);
  });
});
