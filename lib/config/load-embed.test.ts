import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEmbedConfig } from "./load";
import { ConfigError } from "./interpolate";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "portal-embed-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadEmbedConfig", () => {
  it("defaults to self and localhost when there is no portal.yaml", () => {
    expect(loadEmbedConfig({}, dir).frameAncestors).toBe("'self' http://localhost:*");
  });

  it("defaults for an empty document", () => {
    writeFileSync(path.join(dir, "portal.yaml"), "");
    expect(loadEmbedConfig({}, dir).frameAncestors).toBe("'self' http://localhost:*");
  });

  it("reads embed.frameAncestors from ./portal.yaml", () => {
    writeFileSync(path.join(dir, "portal.yaml"), "embed:\n  frameAncestors: \"'self' https://docs.example.com\"\n");
    expect(loadEmbedConfig({}, dir).frameAncestors).toBe("'self' https://docs.example.com");
  });

  it("ignores unset ${VAR} placeholders elsewhere in the file", () => {
    writeFileSync(path.join(dir, "portal.yaml"), "repo:\n  path: ${NOT_SET}\n");
    expect(loadEmbedConfig({}, dir).frameAncestors).toBe("'self' http://localhost:*");
  });

  it("rejects an unknown key under embed", () => {
    writeFileSync(path.join(dir, "portal.yaml"), "embed:\n  frame: x\n");
    expect(() => loadEmbedConfig({}, dir)).toThrowError(ConfigError);
  });
});
