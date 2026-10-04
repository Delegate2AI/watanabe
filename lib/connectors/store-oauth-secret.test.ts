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

const groupsMock = vi.fn(() => ({ eng: {} }) as Record<string, unknown>);
vi.mock("@/lib/authority/access", () => ({
  loadAccess: () => ({ groups: groupsMock() }),
}));

import { writeConnectors, type ConnectorEntryInput } from "./store";

const OAUTH_LINEAR: ConnectorEntryInput = {
  title: "Linear",
  transport: "http",
  url: "https://linear.example/mcp",
  groups: ["eng"],
  auth: "oauth",
  oauthClientId: "the-client-id",
  oauthClientSecret: "${LINEAR_OAUTH_SECRET}",
};

let root: string;
let filePath: string;

function committed(): { files: Record<string, string> } {
  const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
  return { files };
}

function seededEntry(): Record<string, unknown> {
  const written = parseYaml(committed().files["access/connectors.yaml"]) as { connectors: Record<string, unknown> };
  return written.connectors.linear as Record<string, unknown>;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "connectors-oauth-secret-"));
  filePath = path.join(root, "connectors.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("writeConnectors oauthClientSecret carry-forward", () => {
  it("preserves the existing oauthClientSecret when an edit omits it", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: OAUTH_LINEAR }, "admin@example.com", { filePath });
    writeFileSync(filePath, committed().files["access/connectors.yaml"]);

    const edited: ConnectorEntryInput = { ...OAUTH_LINEAR, title: "Linear Issues" };
    delete (edited as { oauthClientSecret?: string }).oauthClientSecret;
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: edited }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(seededEntry().oauthClientSecret).toBe("${LINEAR_OAUTH_SECRET}");
    expect(seededEntry().title).toBe("Linear Issues");
  });

  it("replaces oauthClientSecret when the edit provides a new reference", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: OAUTH_LINEAR }, "admin@example.com", { filePath });
    writeFileSync(filePath, committed().files["access/connectors.yaml"]);

    const edited: ConnectorEntryInput = { ...OAUTH_LINEAR, oauthClientSecret: "${NEW_LINEAR_OAUTH_SECRET}" };
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: edited }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(seededEntry().oauthClientSecret).toBe("${NEW_LINEAR_OAUTH_SECRET}");
  });

  it("drops oauthClientSecret when the edit turns auth off", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: OAUTH_LINEAR }, "admin@example.com", { filePath });
    writeFileSync(filePath, committed().files["access/connectors.yaml"]);

    const edited: ConnectorEntryInput = { title: "Linear", transport: "http", url: "https://linear.example/mcp", groups: ["eng"] };
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: edited }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(seededEntry().oauthClientSecret).toBeUndefined();
    expect(seededEntry().auth).toBeUndefined();
  });

  it("clears oauthClientSecret when the edit explicitly submits an empty string", async () => {
    await writeConnectors({ verb: "upsert", slug: "linear", entry: OAUTH_LINEAR }, "admin@example.com", { filePath });
    writeFileSync(filePath, committed().files["access/connectors.yaml"]);

    const edited: ConnectorEntryInput = { ...OAUTH_LINEAR, oauthClientSecret: "" };
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: edited }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(seededEntry().oauthClientSecret).toBeUndefined();
  });

  it("does not fabricate a secret for a brand new slug with none of its own", async () => {
    const fresh: ConnectorEntryInput = { ...OAUTH_LINEAR };
    delete (fresh as { oauthClientSecret?: string }).oauthClientSecret;
    const result = await writeConnectors({ verb: "upsert", slug: "linear", entry: fresh }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(seededEntry().oauthClientSecret).toBeUndefined();
  });
});
