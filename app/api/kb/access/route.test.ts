import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const setNoteVisibilityMock = vi.fn();
vi.mock("@/lib/authority/set-visibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authority/set-visibility")>()),
  setNoteVisibility: (...args: unknown[]) => setNoteVisibilityMock(...args),
}));
const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...a: unknown[]) => canMock(...a) }));
const flagMock = vi.fn();
vi.mock("@/lib/config/flags", () => ({ isFlagEnabled: (...a: unknown[]) => flagMock(...a) }));
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: async () => ({ identity: { email: "admin@example.com" } }),
}));
const unfilteredVaultRootMock = vi.fn();
vi.mock("@/lib/repo", () => ({ unfilteredVaultRoot: (...a: unknown[]) => unfilteredVaultRootMock(...a) }));

import { GET, POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://x/api/kb/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(query = ""): Request {
  return new Request(`http://x/api/kb/access${query}`);
}

describe("POST /api/kb/access", () => {
  beforeEach(() => {
    canMock.mockReset().mockReturnValue(true);
    flagMock.mockReset().mockReturnValue(true);
    setNoteVisibilityMock.mockReset().mockResolvedValue({ ok: true, count: 1, skipped: [] });
  });

  it("403s a non-admin", async () => {
    canMock.mockReturnValue(false);
    const res = await POST(post({ path: "a.md", visibility: ["exec"] }));
    expect(res.status).toBe(403);
  });

  it("400s an invalid body", async () => {
    const res = await POST(post({ path: "a.md" }));
    expect(res.status).toBe(400);
  });

  it("404s when the flag is off", async () => {
    flagMock.mockReturnValue(false);
    const res = await POST(post({ path: "a.md", visibility: ["exec"] }));
    expect(res.status).toBe(404);
  });

  it("passes through a successful change", async () => {
    const res = await POST(post({ path: "a.md", visibility: ["exec"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(setNoteVisibilityMock).toHaveBeenCalledWith("a.md", ["exec"], "admin@example.com");
  });

  it("returns the change request url an mr-mode write opened", async () => {
    setNoteVisibilityMock.mockResolvedValue({ ok: true, branch: "kb/a/setvis-a", mrUrl: "https://git.example.com/mr/9", count: 1, skipped: [] });
    const res = await POST(post({ path: "a.md", visibility: ["exec"] }));
    expect(await res.json()).toEqual({ branch: "kb/a/setvis-a", mrUrl: "https://git.example.com/mr/9", count: 1, skipped: [] });
  });

  it("502s review_unavailable when the branch was pushed but no change request opened", async () => {
    setNoteVisibilityMock.mockResolvedValue({ ok: false, error: "review_unavailable", branch: "kb/a/setvis-a" });
    const res = await POST(post({ path: "a.md", visibility: ["exec"] }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "review_unavailable" } });
  });
});

describe("GET /api/kb/access", () => {
  let vaultDir: string;

  beforeEach(() => {
    canMock.mockReset().mockReturnValue(true);
    flagMock.mockReset().mockReturnValue(true);
    unfilteredVaultRootMock.mockReset();
    vaultDir = mkdtempSync(path.join(tmpdir(), "kb-access-"));
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("403s a non-admin", async () => {
    canMock.mockReturnValue(false);
    const res = await GET(get("?path=a.md"));
    expect(res.status).toBe(403);
    expect(unfilteredVaultRootMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    flagMock.mockReturnValue(false);
    const res = await GET(get("?path=a.md"));
    expect(res.status).toBe(404);
    expect(unfilteredVaultRootMock).not.toHaveBeenCalled();
  });

  it("400s when the path query param is missing", async () => {
    const res = await GET(get());
    expect(res.status).toBe(400);
    expect(unfilteredVaultRootMock).not.toHaveBeenCalled();
  });

  it("400s a path-traversal attempt without reading any file", async () => {
    const res = await GET(get(`?path=${encodeURIComponent("../access/roles.yaml")}`));
    expect(res.status).toBe(400);
    expect(unfilteredVaultRootMock).not.toHaveBeenCalled();
  });

  it("400s an absolute path without reading any file", async () => {
    const res = await GET(get(`?path=${encodeURIComponent("/etc/passwd")}`));
    expect(res.status).toBe(400);
    expect(unfilteredVaultRootMock).not.toHaveBeenCalled();
  });

  it("200s a valid in-vault file with its visibility", async () => {
    unfilteredVaultRootMock.mockReturnValue(vaultDir);
    writeFileSync(path.join(vaultDir, "a.md"), "---\nvisibility:\n  - exec\n---\n\nbody\n");
    const res = await GET(get("?path=a.md"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visibility).toEqual(["exec"]);
  });

  it("reports all-hands for a folder whose files all default to all-hands", async () => {
    unfilteredVaultRootMock.mockReturnValue(vaultDir);
    mkdirSync(path.join(vaultDir, "finance"));
    writeFileSync(path.join(vaultDir, "finance", "a.md"), "---\ntitle: A\n---\n\nbody\n");
    writeFileSync(path.join(vaultDir, "finance", "b.md"), "# no frontmatter, still all-hands\n");
    const res = await GET(get("?path=finance"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visibility).toEqual(["all-hands"]);
    expect(json.mixed).toBe(false);
  });

  it("reports the common groups and mixed=true when a folder's files differ", async () => {
    unfilteredVaultRootMock.mockReturnValue(vaultDir);
    mkdirSync(path.join(vaultDir, "finance", "nested"), { recursive: true });
    writeFileSync(path.join(vaultDir, "finance", "a.md"), "---\nvisibility:\n  - exec\n  - finance\n---\n\nbody\n");
    writeFileSync(path.join(vaultDir, "finance", "nested", "b.md"), "---\nvisibility:\n  - exec\n---\n\nbody\n");
    const res = await GET(get("?path=finance"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visibility).toEqual(["exec"]);
    expect(json.mixed).toBe(true);
  });
});
