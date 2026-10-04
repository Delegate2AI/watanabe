import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

const ensureWorktreeMock = vi.fn();
const worktreeExistsMock = vi.fn(() => false);
const submitMock = vi.fn();
const discardMock = vi.fn();
let vaultRoot: string;
vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...args: unknown[]) => ensureWorktreeMock(...args),
  worktreeExists: (...args: unknown[]) => worktreeExistsMock(...args),
  worktreeVaultRoot: () => vaultRoot,
  submit: (...args: unknown[]) => submitMock(...args),
  discard: (...args: unknown[]) => discardMock(...args),
}));

const createMergeRequestMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (...args: unknown[]) => createMergeRequestMock(...args),
  }),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
  isRolesEnabled: () => true,
}));

const { publishDocument } = await import("./publish");
const { openDb } = await import("@/lib/db/client");
const { addPublication, createDocument, getPublication } = await import("./store");

const ALICE = "alice@example.com";
let db: DatabaseType;
let tmpRoot: string;

function document(id = "d1", ownerEmail = ALICE) {
  createDocument(db, { id, ownerEmail, title: "Risk Disclosure", body: "# Risk\n\nBody text.", originThreadId: null });
}

function readyDocument(id = "d1", targetPath: string | null = "docs/notes/risk.md") {
  document(id);
  addPublication(db, {
    docId: id,
    status: "ready",
    targetPath,
    targetVisibility: ["exec"],
    publishedNotePath: null,
  });
}

beforeEach(() => {
  process.env.UNIFIED_DOCS = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
  process.env.REPO_WRITE_TOKEN = "tok";
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "document-publish-"));
  vaultRoot = tmpRoot;
  db = openDb(":memory:");
  ensureWorktreeMock.mockReset().mockResolvedValue(tmpRoot);
  worktreeExistsMock.mockReset().mockReturnValue(false);
  submitMock.mockReset().mockResolvedValue({ ok: true, branch: "kb/alice/risk-disclosure-1" });
  discardMock.mockReset().mockResolvedValue(undefined);
  createMergeRequestMock.mockReset().mockResolvedValue({ webUrl: "https://gl/mr/1" });
  canMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  for (const key of ["UNIFIED_DOCS", "KB_WRITE_ENABLED", "ROLES_ENABLED", "REPO_WRITE_TOKEN"]) delete process.env[key];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("publishDocument", () => {
  it("returns 404 without touching the write path when unified documents are off", async () => {
    delete process.env.UNIFIED_DOCS;
    readyDocument();
    expect(await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "mr" })).toEqual({
      ok: false,
      status: 404,
      error: "publishing is not enabled",
    });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("denies a non-writer", async () => {
    canMock.mockReturnValue(false);
    readyDocument();
    expect(await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "mr" })).toMatchObject({ ok: false, status: 403 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("denies direct publishing without the approver role", async () => {
    canMock.mockImplementation((_email: string, capability: string) => capability === "write");
    readyDocument();
    expect(await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "direct" })).toMatchObject({ ok: false, status: 403 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("returns 409 for a missing or non-ready publication", async () => {
    document();
    const missing = await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "mr" });
    addPublication(db, { docId: "d1", status: "draft", targetPath: "docs/x.md", targetVisibility: null, publishedNotePath: null });
    const draft = await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "mr" });
    expect(missing).toEqual({ ok: false, status: 409, error: "only a ready document can be published" });
    expect(draft).toEqual(missing);
  });

  it("returns 409 when the ready publication has no target path", async () => {
    readyDocument("d1", null);
    expect(await publishDocument(db, { id: "d1", ownerEmail: ALICE, mode: "mr" })).toEqual({
      ok: false,
      status: 409,
      error: "the document has no target path",
    });
  });

  it("returns identical 404 results for foreign and unknown ids", async () => {
    readyDocument();
    const foreign = await publishDocument(db, { id: "d1", ownerEmail: "mallory@example.com", mode: "mr" });
    const unknown = await publishDocument(db, { id: "missing", ownerEmail: ALICE, mode: "mr" });
    expect(foreign).toEqual({ ok: false, status: 404, error: "document not found" });
    expect(unknown).toEqual(foreign);
  });

  it("publishes a ready document by MR and records the resolved note path", async () => {
    canMock.mockImplementation((_email: string, capability: string) => capability === "write");
    readyDocument();
    const result = await publishDocument(db, { id: "d1", ownerEmail: ALICE, ownerName: "Alice", mode: "mr" });
    expect(result).toMatchObject({ ok: true, mode: "mr", mrUrl: "https://gl/mr/1", notePath: "docs/notes/risk.md" });
    expect(fs.readFileSync(path.join(tmpRoot, "notes/risk.md"), "utf8")).toContain("Body text.");
    expect(submitMock).toHaveBeenCalledWith("document-d1", expect.objectContaining({ message: "Publish document: Risk Disclosure" }));
    expect(getPublication(db, "d1")).toMatchObject({ status: "published", publishedNotePath: "docs/notes/risk.md" });
  });
});
