import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

// Clearance keys are now resolved against access/groups.yaml, the same check
// the skills admin surface applies. Declaring the fixture's groups here keeps
// these tests about the write path rather than about a real access checkout.
const groupsMock = vi.fn(() => ({ eng: {}, finance: {} }) as Record<string, unknown>);
vi.mock("@/lib/authority/access", () => ({
  loadAccess: () => ({ groups: groupsMock() }),
}));

// Partial mock: the real loader still runs by default, because the round-trip
// check is the point of these tests. The invalidator is observed but still
// calls through, so the real cache slot is cleared between writes in one test,
// and the loader is observable so one test can force the reparse to disagree.
// Everything the factory closes over is read lazily, at call time: vitest
// hoists both the vi.mock call and the imports above these declarations, so an
// eager read from inside the factory would hit the temporal dead zone.
const invalidateSpy = vi.fn();
// A holder object, not a `let`: prefer-const's autofix rewrites a binding whose
// reassignments all live further down the file, and a const cannot be swapped
// per test.
const override: { load: ((filePath?: string) => ConnectorRegistry) | null } = { load: null };
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  return {
    ...actual,
    loadConnectorRegistry: (filePath?: string) =>
      override.load ? override.load(filePath) : actual.loadConnectorRegistry(filePath),
    invalidateConnectorRegistryCache: () => {
      invalidateSpy();
      actual.invalidateConnectorRegistryCache();
    },
  };
});

import { writeConnectors, type ConnectorEntryInput } from "./store";
import type { ConnectorRegistry } from "./types";

const LINEAR: ConnectorEntryInput = {
  title: "Linear",
  transport: "http",
  url: "https://linear.example/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["eng"],
  tools: ["search"],
};

let root: string;
let filePath: string;
const savedEnv = { ...process.env };

function committed(): { files: Record<string, string>; options: { message: string; authorName: string; authorEmail: string } } {
  const [files, options] = commitPrivateAccessMock.mock.calls.at(-1) as [
    Record<string, string>,
    { message: string; authorName: string; authorEmail: string },
  ];
  return { files, options };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "connectors-store-"));
  filePath = path.join(root, "connectors.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  invalidateSpy.mockReset();
  override.load = null;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("writeConnectors", () => {
  it("refuses a caller without manageAccess before reading or committing", async () => {
    canMock.mockReturnValue(false);

    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "nobody@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("commits an upsert as access/connectors.yaml, authored by the actor", async () => {
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "Admin@Example.com", { filePath });

    expect(result).toEqual({ ok: true });
    const { files, options } = committed();
    expect(Object.keys(files)).toEqual(["access/connectors.yaml"]);
    expect(parseYaml(files["access/connectors.yaml"])).toEqual({ connectors: { linear: LINEAR } });
    expect(options.message).toBe("chore(access): upsert connector linear");
    expect(options.authorName).toBe("admin@example.com");
    expect(options.authorEmail).toBe("admin@example.com");
  });

  it("serializes and reparses the whole file through the real loader before committing", async () => {
    writeFileSync(filePath, "connectors:\n  wiki:\n    title: Wiki\n    transport: sse\n    url: https://w.example\n    groups: [all-hands]\n");

    await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    const written = parseYaml(committed().files["access/connectors.yaml"]) as { connectors: Record<string, unknown> };
    expect(Object.keys(written.connectors)).toEqual(["linear", "wiki"]);
  });

  it("refuses an upsert of a reserved slug", async () => {
    const result = await writeConnectors({ verb: "upsert", slug: "kb", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "reserved slug" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a slug that is not a valid connector slug", async () => {
    const result = await writeConnectors({ verb: "upsert", slug: "Not A Slug", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "invalid slug" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it.each(["constructor", "prototype"])("refuses an upsert of the prototype key %s", async (slug) => {
    const result = await writeConnectors({ verb: "upsert", slug, entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "invalid slug" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an entry that fails the per-entry schema", async () => {
    const broken = { title: "Broken", transport: "http", groups: ["eng"] } as unknown as ConnectorEntryInput;

    const result = await writeConnectors({ verb: "upsert", slug: "broken", entry: broken }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "invalid connector entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a remove of a slug the file does not carry", async () => {
    const result = await writeConnectors({ verb: "remove", slug: "linear" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "unknown connector" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("commits a remove of a registered slug", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });
    writeFileSync(filePath, committed().files["access/connectors.yaml"]);

    const result = await writeConnectors({ verb: "remove", slug: "linear" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(parseYaml(committed().files["access/connectors.yaml"])).toEqual({ connectors: {} });
    expect(committed().options.message).toBe("chore(access): remove connector linear");
  });

  it.each([
    ["a reserved slug", "kb", "connectors:\n  kb:\n    title: Shadow\n    transport: http\n    url: https://s.example\n    groups: [eng]\n"],
    ["a malformed slug", "Legacy-Thing", "connectors:\n  Legacy-Thing:\n    title: Legacy\n    transport: http\n    url: https://l.example\n    groups: [eng]\n"],
    ["a prototype key", "constructor", "connectors:\n  constructor:\n    title: Proto\n    transport: http\n    url: https://p.example\n    groups: [eng]\n"],
  ])("removes %s that only a hand-edit could have introduced", async (_label, slug, seed) => {
    writeFileSync(filePath, seed);

    const result = await writeConnectors({ verb: "remove", slug }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(parseYaml(committed().files["access/connectors.yaml"])).toEqual({ connectors: {} });
    expect(committed().options.message).toBe(`chore(access): remove connector ${slug}`);
  });

  it("still refuses a remove of a reserved slug the file does not carry", async () => {
    const result = await writeConnectors({ verb: "remove", slug: "kb" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "unknown connector" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses when the reparsed file does not match what the change intended", async () => {
    // The invariant is not reachable through the public surface, so force it:
    // the temp-dir read that validates the candidate reports a file the writer
    // never asked for.
    const actual = await vi.importActual<typeof import("./registry")>("./registry");
    override.load = (p?: string) =>
      p?.includes("connectors-validate-") ? { entries: [], errors: [] } : actual.loadConnectorRegistry(p);

    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "connector configuration failed validation" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("keeps an entry the loader rejects instead of silently dropping it", async () => {
    writeFileSync(filePath, "connectors:\n  bad:\n    title: Bad\n    transport: http\n");

    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    const written = parseYaml(committed().files["access/connectors.yaml"]) as { connectors: Record<string, unknown> };
    expect(Object.keys(written.connectors)).toEqual(["bad", "linear"]);
  });

  it("refuses to clobber a file it cannot parse", async () => {
    writeFileSync(filePath, "connectors: [not: valid");

    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "connectors file is unreadable" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("invalidates the registry cache after a successful write", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("reports a refused commit and does not claim success", async () => {
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "private access checkout unavailable" });

    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: LINEAR }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "private access checkout unavailable" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
