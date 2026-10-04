import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: DatabaseType;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/roles")>();
  return {
    ...actual,
    can: (...args: unknown[]) => canMock(...args),
    isRolesEnabled: () => true,
  };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertArtifact, updateArtifact } = await import("@/lib/db/artifacts");

const EDITOR = { email: "editor@example.com", name: "Editor" };

beforeEach(() => {
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: EDITOR });
  canMock.mockReset().mockImplementation((_email: string, capability: string) => capability === "write");
  insertArtifact(db, {
    id: "a1",
    title: "Risk",
    ownerEmail: EDITOR.email,
    body: "# Risk",
  });
  updateArtifact(db, "a1", EDITOR.email, {
    targetPath: "docs/03-product/risk.md",
    targetVisibility: ["all-hands"],
    status: "ready",
  });
});

describe("POST /api/artifacts/[id]/publish direct gate", () => {
  it("returns 403 when an editor forges a direct-mode request", async () => {
    const request = new Request("http://t/api/artifacts/a1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "direct" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: "a1" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });
});
