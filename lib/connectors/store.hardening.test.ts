import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Review-round hardening of the connectors write path, all of it closing a gap
 * where spec 33 and spec 34 were near-twins and only the skills twin was
 * hardened: clearance keys resolved against `access/groups.yaml`, a raw
 * `__proto__` own key refused, and `${VAR}` refused everywhere it would have
 * been used literally. The base write-path cases live in store.test.ts.
 */

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

const groupsMock = vi.fn();
vi.mock("@/lib/authority/access", () => ({
  loadAccess: () => ({ groups: groupsMock() }),
}));

const { writeConnectors } = await import("./store");
const { invalidateConnectorRegistryCache, loadConnectorRegistry } = await import("./registry");
const { EntrySchema } = await import("./types");

type EntryInput = Parameters<typeof writeConnectors>[0] extends { entry: infer E } ? E : never;

const LINEAR = {
  title: "Linear",
  transport: "http",
  url: "https://linear.example/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["eng"],
} as const;

let root: string;
let filePath: string;

function upsert(entry: unknown) {
  return writeConnectors(
    { verb: "upsert", slug: "linear", entry: entry as EntryInput },
    "admin@example.com",
    { filePath },
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "connectors-hard-"));
  filePath = path.join(root, "connectors.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  groupsMock.mockReset().mockReturnValue({ eng: {}, finance: {} });
  invalidateConnectorRegistryCache();
});

afterEach(() => {
  invalidateConnectorRegistryCache();
  rmSync(root, { recursive: true, force: true });
});

describe("writeConnectors: clearance keys must exist in access/groups.yaml", () => {
  it("refuses a group key nothing declares, which would grant to nobody forever", async () => {
    const result = await upsert({ ...LINEAR, groups: ["enginering"] });

    expect(result).toEqual({ ok: false, error: "invalid connector groups" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a group that does not exist YET, the deferred-grant shape", async () => {
    // Saving `future-finance` before the group exists would silently start
    // granting the day somebody created it, with no connector edit and no
    // connector audit entry.
    const result = await upsert({ ...LINEAR, groups: ["future-finance"] });

    expect(result).toEqual({ ok: false, error: "invalid connector groups" });
  });

  it("fails closed when access cannot be read at all", async () => {
    groupsMock.mockImplementation(() => {
      throw new Error("no access checkout");
    });

    const result = await upsert(LINEAR);

    expect(result).toEqual({ ok: false, error: "invalid connector groups" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("de-duplicates and sorts a declared list, so a groups edit is a stable diff", async () => {
    const result = await upsert({ ...LINEAR, groups: ["finance", "eng", "finance"] });

    expect(result).toEqual({ ok: true });
    const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
    expect(files["access/connectors.yaml"]).toContain("- eng");
    expect(files["access/connectors.yaml"]).toContain("- finance");
    expect(files["access/connectors.yaml"].match(/- finance/g)).toHaveLength(1);
  });

  it("accepts every declared key", async () => {
    expect(await upsert({ ...LINEAR, groups: ["eng", "finance"] })).toEqual({ ok: true });
  });
});

describe("writeConnectors: a raw __proto__ own key is refused, not silently dropped", () => {
  it("refuses the key zod's strict mode does not catch", async () => {
    // `JSON.parse` produces exactly this shape, and bracket assignment on the
    // name invokes the prototype setter instead of creating a data property, so
    // rebuilding the object would consume the key and hide it from Object.keys.
    const entry = JSON.parse(`{"title":"L","transport":"http","url":"https://l.example","groups":["eng"],"__proto__":{"x":1}}`);

    expect(await upsert(entry)).toEqual({ ok: false, error: "invalid connector entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});

describe("EntrySchema refuses ${VAR} outside headers and env", () => {
  it("refuses a url that would otherwise be sent to the SDK literally", () => {
    expect(EntrySchema.safeParse({ ...LINEAR, url: "https://${MCP_HOST}/mcp" }).success).toBe(false);
  });

  it("refuses a command and an arg, which would put a secret in process argv", () => {
    const stdio = { title: "L", transport: "stdio", command: "${MCP_BIN}", groups: ["eng"] };
    expect(EntrySchema.safeParse(stdio).success).toBe(false);
    expect(
      EntrySchema.safeParse({ ...stdio, command: "node", args: ["--token=${TOKEN}"] }).success,
    ).toBe(false);
  });

  it("still accepts references in headers and env, which is where secrets belong", () => {
    expect(EntrySchema.safeParse(LINEAR).success).toBe(true);
    expect(
      EntrySchema.safeParse({
        title: "L",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "${TOKEN}" },
        groups: ["eng"],
      }).success,
    ).toBe(true);
  });

  it("refuses the write, so the admin sees an error instead of a literal placeholder", async () => {
    expect(await upsert({ ...LINEAR, url: "https://${MCP_HOST}/mcp" })).toEqual({
      ok: false,
      error: "invalid connector entry",
    });
  });

  it("shows a hand-edited file's placeholder as a disabled row with a reason", () => {
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  linear:",
        "    title: Linear",
        "    transport: http",
        '    url: "https://${MCP_HOST}/mcp"',
        "    groups: [eng]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors[0].slug).toBe("linear");
    expect(registry.errors[0].reason).toContain("headers and env only");
  });
});
