import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread } from "@/lib/db/threads";
import { insertArtifact } from "@/lib/db/artifacts";
import { insertSharedDoc } from "@/lib/db/shared-docs";
import { insertProposed } from "@/lib/db/tasks";
import { globalSearch, type SearchItem } from "./global";

let db: DatabaseType;
const kbStub = vi.fn(async (): Promise<SearchItem[]> => []);
const ME = "alice@example.com";

beforeEach(() => {
  db = openDb(":memory:");
  kbStub.mockClear().mockResolvedValue([]);
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
  process.env.MEMORY_ENABLED = "0";
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
});

const ctx = () => ({ db, email: ME, clearance: ["all-hands"] });

describe("globalSearch", () => {
  it("returns nothing for a blank query", async () => {
    expect(await globalSearch("   ", ctx(), { kbSearch: kbStub })).toEqual([]);
    expect(kbStub).not.toHaveBeenCalled();
  });

  it("fans out across sources, matching titles, scoped to the caller", async () => {
    recordThread(db, "t1", ME, "Rebalance planning");
    recordThread(db, "t2", ME, "Unrelated chat");
    recordThread(db, "t3", "bob@example.com", "Rebalance secrets"); // not mine
    insertArtifact(db, { id: "a1", title: "Rebalance summary", ownerEmail: ME, body: "x" });
    insertSharedDoc(db, { id: "s1", title: "Rebalance notes", ownerEmail: ME, body: "y" });
    insertProposed(db, {
      id: "k1",
      title: "Do the rebalance",
      description: "reconcile",
      assigneeEmail: ME,
      sourceMeetingId: "m1",
      sourceNotePath: "docs/meetings/m1.md",
      clearance: ["all-hands"],
      due: null,
      origin: "agent",
      createdAt: "2026-07-11T00:00:00Z",
    });
    kbStub.mockResolvedValue([{ title: "Rebalance policy", href: "/kb/notes/rebalance", snippet: "the policy" }]);

    const groups = await globalSearch("rebalance", ctx(), { kbSearch: kbStub });
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.items]));

    expect(byLabel["Knowledge base"]).toHaveLength(1);
    expect(byLabel["Chats"].map((i) => i.href)).toEqual(["/chat/t1"]); // not bob's, not unrelated
    expect(byLabel["Artifacts"][0].href).toBe("/artifacts/a1");
    expect(byLabel["Shared docs"][0].href).toBe("/docs/s1");
    // A result names one task, so it links to that task.
    expect(byLabel["Tasks"][0].href).toBe("/tasks/k1");
  });

  it("omits a source whose flag is off", async () => {
    delete process.env.ARTIFACTS_ENABLED;
    insertArtifact(db, { id: "a1", title: "Rebalance summary", ownerEmail: ME, body: "x" });
    const groups = await globalSearch("rebalance", ctx(), { kbSearch: kbStub });
    expect(groups.find((g) => g.label === "Artifacts")).toBeUndefined();
  });

  it("reduces a task snippet to plaintext", async () => {
    insertProposed(db, {
      id: "k2",
      title: "Do the rebalance",
      description: "## Steps\n\n- [[04-economy/tokenomics]] - reconcile the [ledger](https://x.test)",
      assigneeEmail: ME,
      sourceMeetingId: "m1",
      sourceNotePath: "docs/meetings/m1.md",
      clearance: ["all-hands"],
      due: null,
      origin: "agent",
      createdAt: "2026-07-11T00:00:00Z",
    });

    const groups = await globalSearch("rebalance", ctx(), { kbSearch: kbStub });
    const task = groups.find((g) => g.label === "Tasks")?.items[0];
    expect(task?.snippet).toBe("Steps tokenomics reconcile the ledger");
  });
});

/**
 * The default KB source, wired to a real vault on disk rather than the stub, so
 * the frontmatter-exclusion rule is exercised end to end through `searchKb`.
 */
describe("globalSearch over a real vault", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "global-search-"));
    process.env.LOCAL_REPO_PATH = repo;
    process.env.VAULT_SUBDIR = ".";
    delete process.env.REPO_READ_TOKEN;
    delete process.env.AUTHORITY_ENABLED;
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    delete process.env.LOCAL_REPO_PATH;
    delete process.env.VAULT_SUBDIR;
  });

  function write(rel: string, content: string): void {
    const abs = path.join(repo, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  it("returns no KB row whose only match was frontmatter", async () => {
    write("04-economy/tokenomics.md", "---\ntitle: Emission Design\nowner: maria.chen@example.com\n---\nEmission curves.");
    write("people/maria.md", "---\ntitle: Maria Chen\n---\nHead of finance.");

    const groups = await globalSearch("maria", ctx());
    const kb = groups.find((g) => g.label === "Knowledge base")?.items ?? [];
    expect(kb.map((i) => i.href)).toEqual(["/kb/people/maria"]);
  });
});

describe("globalSearch people section", () => {
  it("is absent when the people directory is off", async () => {
    delete process.env.PEOPLE_ENABLED;
    const groups = await globalSearch("rebalance", ctx(), { kbSearch: kbStub });
    expect(groups.find((g) => g.label === "People")).toBeUndefined();
  });
});
