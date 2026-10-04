import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The clearance projection, stood in for: each clearance set gets its own root
// directory, and a note the requester may not see is simply absent from theirs.
// That absence IS the boundary in the real system (spec 19), so a fake that
// reproduces it exercises the same code path the deployment does.
const roots = new Map<string, string>();
vi.mock("@/lib/repo", () => ({
  vaultRootFor: (clearance: string[]) => roots.get([...clearance].sort().join(",")) ?? "/nonexistent",
}));

const { openDb } = await import("./client");
const { createProject } = await import("./projects");
const {
  insertProjectReference,
  listProjectReferences,
  resolveKbTarget,
  resolveProjectReferences,
} = await import("./project-references");

const ALICE = "alice@example.com";

let db: import("better-sqlite3").Database;
let allHands: string;
let exec: string;

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function reference(overrides: Partial<Parameters<typeof insertProjectReference>[1]> = {}) {
  return {
    id: "r1",
    projectId: "p1",
    kind: "kb" as const,
    targetId: "03-product/trader-score.md",
    addedBy: ALICE,
    createdAt: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  allHands = mkdtempSync(path.join(tmpdir(), "kb-ref-all-"));
  exec = mkdtempSync(path.join(tmpdir(), "kb-ref-exec-"));
  roots.clear();
  roots.set("all-hands", allHands);
  roots.set("all-hands,exec", exec);

  // The public note is in both projections; the restricted one only in exec's.
  const publicNote = "---\ntitle: Trader Score\n---\n# Trader Score\n\nHow the score works.";
  write(allHands, "03-product/trader-score.md", publicNote);
  write(exec, "03-product/trader-score.md", publicNote);
  write(exec, "04-economy/fee-splits.md", "---\ntitle: Fee Splits\nvisibility: [exec]\n---\nNumbers.");

  createProject(db, {
    id: "p1",
    name: "Meridian specs",
    description: null,
    context: null,
    clearance: ["all-hands"],
    ownerEmail: ALICE,
    createdAt: "2026-08-01T00:00:00Z",
  });
});

afterEach(() => {
  rmSync(allHands, { recursive: true, force: true });
  rmSync(exec, { recursive: true, force: true });
});

describe("resolveKbTarget", () => {
  it("resolves a note to its canonical path, title, and clean-URL href", () => {
    expect(resolveKbTarget("03-product/trader-score.md", ["all-hands"])).toEqual({
      relPath: "03-product/trader-score.md",
      title: "Trader Score",
      href: "/kb/03-product/trader-score",
    });
  });

  it("normalizes the extensionless spelling to the on-disk path", () => {
    // Both spellings name one note, so both must store one target id or the
    // UNIQUE (project, kind, target) constraint cannot see the duplicate.
    expect(resolveKbTarget("03-product/trader-score", ["all-hands"])?.relPath).toBe(
      "03-product/trader-score.md",
    );
  });

  it("answers a restricted note and an invented path identically", () => {
    expect(resolveKbTarget("04-economy/fee-splits.md", ["all-hands"])).toBeNull();
    expect(resolveKbTarget("04-economy/no-such-note.md", ["all-hands"])).toBeNull();
    // Same path, cleared requester: the note does exist, which is what makes the
    // pair above a boundary rather than a coincidence.
    expect(resolveKbTarget("04-economy/fee-splits.md", ["all-hands", "exec"])?.title).toBe("Fee Splits");
  });

  it("refuses a traversal escape and a directory", () => {
    expect(resolveKbTarget("../../etc/passwd", ["all-hands"])).toBeNull();
    expect(resolveKbTarget("03-product", ["all-hands"])).toBeNull();
    expect(resolveKbTarget("", ["all-hands"])).toBeNull();
  });
});

describe("kb project references", () => {
  it("resolves a kb row to the note's live title and link", () => {
    insertProjectReference(db, reference());
    const resolved = resolveProjectReferences(db, "p1", ALICE, ["all-hands"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      kind: "kb",
      title: "Trader Score",
      href: "/kb/03-product/trader-score",
    });
  });

  it("shows a restricted note only to a cleared requester, keeping the row", () => {
    insertProjectReference(db, reference({ targetId: "04-economy/fee-splits.md" }));

    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(0);
    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands", "exec"])).toHaveLength(1);
    // The row survives the requester who cannot see it: widening clearance (or
    // the note's own visibility) brings it back with nobody touching the project.
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });

  it("omits a kb row whose note has left the vault", () => {
    insertProjectReference(db, reference({ targetId: "03-product/deleted.md" }));
    expect(resolveProjectReferences(db, "p1", ALICE, ["all-hands"])).toHaveLength(0);
  });

  it("treats a repeat attachment of the same path as a no-op", () => {
    expect(insertProjectReference(db, reference())).toBe(true);
    expect(insertProjectReference(db, reference({ id: "r2" }))).toBe(false);
    expect(listProjectReferences(db, "p1")).toHaveLength(1);
  });
});
