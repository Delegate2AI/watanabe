import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEgressUrl } from "./egress";
import { createResolve, reasonOf } from "./egress-fixtures";

const resolve = createResolve();

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

describe("checkEgressUrl", () => {
  it("accepts an https url that resolves to a public address", async () => {
    const result = await checkEgressUrl("https://api.example.com/mcp", { resolve });

    expect(result.ok).toBe(true);
    expect(result.ok && result.url.toString()).toBe("https://api.example.com/mcp");
  });

  it("accepts an https url that resolves to a public ipv6 address", async () => {
    expect((await checkEgressUrl("https://v6.example.com/mcp", { resolve })).ok).toBe(true);
  });

  it("refuses a plaintext http url", async () => {
    const result = await checkEgressUrl("http://api.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("http");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("allows http on localhost outside production so local dev keeps working", async () => {
    vi.stubEnv("NODE_ENV", "development");

    expect((await checkEgressUrl("http://localhost:3100/mcp", { resolve })).ok).toBe(true);
  });

  it("refuses http on localhost in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await checkEgressUrl("http://localhost:3100/mcp", { resolve })).ok).toBe(false);
  });

  it("refuses a loopback address in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await checkEgressUrl("https://loop.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("loopback");
  });

  it("refuses a scheme that is neither http nor https", async () => {
    expect((await checkEgressUrl("file:///etc/passwd", { resolve })).ok).toBe(false);
    expect((await checkEgressUrl("ftp://api.example.com/x", { resolve })).ok).toBe(false);
  });

  it("refuses a string that is not an absolute url", async () => {
    expect((await checkEgressUrl("/mcp", { resolve })).ok).toBe(false);
    expect((await checkEgressUrl("", { resolve })).ok).toBe(false);
    expect((await checkEgressUrl("https://", { resolve })).ok).toBe(false);
  });

  it("refuses every private ipv4 range", async () => {
    for (const host of ["internal", "corp", "docker", "cgnat"]) {
      const result = await checkEgressUrl(`https://${host}.example.com/mcp`, { resolve });

      expect(result.ok).toBe(false);
      expect(reasonOf(result)).toContain("private");
    }
  });

  it("refuses a link local address", async () => {
    const result = await checkEgressUrl("https://link.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("link local");
  });

  it("refuses the ipv4 unspecified address and the rest of its /8 block", async () => {
    const unspecified = await checkEgressUrl("https://unspec.example.com/mcp", { resolve });
    expect(unspecified.ok).toBe(false);
    expect(reasonOf(unspecified)).toContain("unspecified");

    const block = await checkEgressUrl("https://unspec-block.example.com/mcp", { resolve });
    expect(block.ok).toBe(false);
    expect(reasonOf(block)).toContain("unspecified");
  });

  it("refuses the ipv6 unspecified address", async () => {
    const result = await checkEgressUrl("https://v6unspec.example.com/mcp", { resolve });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("unspecified");
  });

  it("refuses the ipv4 and ipv6 unspecified addresses as ip literal hosts, without asking dns", async () => {
    const ipv4 = await checkEgressUrl("https://0.0.0.0/mcp", { resolve });
    expect(ipv4.ok).toBe(false);
    expect(reasonOf(ipv4)).toContain("unspecified");

    const ipv6 = await checkEgressUrl("https://[::]/mcp", { resolve });
    expect(ipv6.ok).toBe(false);
    expect(reasonOf(ipv6)).toContain("unspecified");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses the ipv4 cloud metadata address", async () => {
    const result = await checkEgressUrl("https://meta.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("metadata");
  });

  it("refuses the ipv6 cloud metadata address", async () => {
    const result = await checkEgressUrl("https://awsmeta.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("metadata");
  });

  it("refuses the metadata address hidden behind an ipv4 mapped ipv6 address", async () => {
    expect((await checkEgressUrl("https://mapped.example.com/mcp", { resolve })).ok).toBe(false);
  });

  it("refuses a unique local ipv6 address", async () => {
    const result = await checkEgressUrl("https://ula.example.com/mcp", { resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("unique local");
  });

  it("refuses a link local ipv6 address", async () => {
    expect((await checkEgressUrl("https://v6link.example.com/mcp", { resolve })).ok).toBe(false);
  });

  it("refuses when any one of several resolved addresses is private", async () => {
    expect((await checkEgressUrl("https://mixed.example.com/mcp", { resolve })).ok).toBe(false);
  });

  it("refuses an ip literal host that is private without asking dns", async () => {
    expect((await checkEgressUrl("https://169.254.169.254/latest/meta-data", { resolve })).ok).toBe(false);
    expect((await checkEgressUrl("https://[fd00:ec2::254]/latest", { resolve })).ok).toBe(false);
  });

  it("refuses a host that does not resolve", async () => {
    expect((await checkEgressUrl("https://absent.example.com/mcp", { resolve })).ok).toBe(false);
  });

  it("refuses a host that resolves to nothing at all", async () => {
    expect((await checkEgressUrl("https://empty.example.com/mcp", { resolve })).ok).toBe(false);
  });

  it("normalizes a trailing dot and an upper case host", async () => {
    const result = await checkEgressUrl("https://API.Example.com./mcp", { resolve });

    expect(result.ok && result.url.hostname).toBe("api.example.com");
    expect(resolve).toHaveBeenCalledWith("api.example.com", { all: true });
  });

  it("returns a refusal rather than throwing when the resolver blows up", async () => {
    const angry = vi.fn(async () => {
      throw new Error("resolver exploded");
    });

    const result = await checkEgressUrl("https://api.example.com/mcp", { resolve: angry });

    expect(result.ok).toBe(false);
    expect(typeof reasonOf(result)).toBe("string");
  });
});
