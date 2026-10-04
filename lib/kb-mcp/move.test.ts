import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planMove } from "./move";

/**
 * A move is not an edit plus a delete: every inbound link breaks, and nothing
 * downstream would catch it. `planMove` is pure over a root so it is testable
 * against a temp vault with no git in the way.
 */

let root: string;

function note(rel: string, body: string): void {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function applied(rel: string, plan: Extract<ReturnType<typeof planMove>, { renames: unknown }>): string | undefined {
  return plan.rewrites.find((r) => r.path === rel)?.content;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "move-test-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("planMove", () => {
  it("renames the file and rewrites both link syntaxes that point at it", () => {
    note("a/one.md", "# One\n");
    note("c/two.md", "See [[a/one]] for detail.\n");
    note("d/three.md", "See [One](../a/one.md) for detail.\n");
    note("e/four.md", "Unrelated [Other](../a/other.md).\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);

    expect(plan.renames).toEqual([{ from: "a/one.md", to: "b/one.md" }]);
    expect(applied("c/two.md", plan)).toContain("[[b/one]]");
    expect(applied("d/three.md", plan)).toContain("../b/one.md");
    // A link to a different file is not touched, so it is not in the plan.
    expect(applied("e/four.md", plan)).toBeUndefined();
  });

  it("keeps a wikilink's own alias and heading", () => {
    note("a/one.md", "# One\n");
    note("c/two.md", "See [[a/one#Summary|the summary]].\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toContain("[[b/one#Summary|the summary]]");
  });

  it("moves every file beneath a directory", () => {
    note("a/one.md", "# One\n");
    note("a/deep/two.md", "# Two\n");

    const plan = planMove(root, "a", "b");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.renames).toEqual([
      { from: "a/deep/two.md", to: "b/deep/two.md" },
      { from: "a/one.md", to: "b/one.md" },
    ]);
  });

  it("rewrites a link from a file that is itself moving", () => {
    note("a/one.md", "Sibling: [[a/two]]\n");
    note("a/two.md", "# Two\n");

    const plan = planMove(root, "a", "b");
    if ("error" in plan) throw new Error(plan.error);
    // The rewrite is keyed by the file's NEW path: rewriting the old one would
    // write into a file the same plan is about to delete.
    expect(applied("b/one.md", plan)).toContain("[[b/two]]");
  });

  it("refuses a destination that already exists", () => {
    note("a/one.md", "# One\n");
    note("b/one.md", "# Other\n");
    expect(planMove(root, "a/one.md", "b/one.md")).toEqual({ error: expect.stringContaining("already exists") });
  });

  it("refuses a source that does not exist", () => {
    expect(planMove(root, "a/ghost.md", "b/ghost.md")).toEqual({ error: expect.stringContaining("No such") });
  });

  it("refuses a move into or out of a system-owned folder", () => {
    note("meetings/standup.md", "# Standup\n");
    note("a/one.md", "# One\n");

    expect(planMove(root, "meetings/standup.md", "a/standup.md")).toEqual({
      error: expect.stringContaining("meetings"),
    });
    expect(planMove(root, "a/one.md", "meetings/one.md")).toEqual({
      error: expect.stringContaining("meetings"),
    });
  });

  it("refuses a source or destination outside the vault", () => {
    note("a/one.md", "# One\n");
    expect(planMove(root, "../escape.md", "a/two.md")).toEqual({ error: expect.stringContaining("outside") });
    expect(planMove(root, "a/one.md", "../escape.md")).toEqual({ error: expect.stringContaining("outside") });
  });

  it("refuses a move onto itself rather than deleting the file", () => {
    note("a/one.md", "# One\n");
    expect(planMove(root, "a/one.md", "a/one.md")).toEqual({ error: expect.stringContaining("same path") });
  });

  it("refuses to move the vault root, which has no name to move", () => {
    note("top.md", "# Top\n");
    note("a/one.md", "# One\n");
    expect(planMove(root, ".", "b")).toEqual({ error: expect.stringContaining("whole knowledge base") });
    expect(planMove(root, "", "b")).toEqual({ error: expect.stringContaining("whole knowledge base") });
    // Checked after resolution, not on the raw string: these all normalize to
    // the root too.
    expect(planMove(root, "./", "b")).toEqual({ error: expect.stringContaining("whole knowledge base") });
    expect(planMove(root, "a/..", "b")).toEqual({ error: expect.stringContaining("whole knowledge base") });
    expect(planMove(root, "a/one.md", "./")).toEqual({ error: expect.stringContaining("whole knowledge base") });
  });

  it("refuses a destination nested inside the source", () => {
    note("a/one.md", "# One\n");
    expect(planMove(root, "a", "a/b")).toEqual({ error: expect.stringContaining("inside") });
  });

  it("refuses a source reached through a symlink out of the vault", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "# Secret\n");
    fs.symlinkSync(outside, path.join(root, "escape"));
    try {
      expect(planMove(root, "escape/secret.md", "a/stolen.md")).toEqual({
        error: expect.stringContaining("outside"),
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("moves every file under a directory, not only the markdown", () => {
    note("a/one.md", "# One\n");
    fs.writeFileSync(path.join(root, "a/diagram.png"), "not really a png");

    const plan = planMove(root, "a", "b");
    if ("error" in plan) throw new Error(plan.error);
    // The directory itself moves, so nothing is left behind under the old name.
    expect(plan.directory).toEqual({ from: "a", to: "b" });
  });

  it("keeps a markdown link's heading fragment", () => {
    note("a/one.md", "# One\n");
    note("c/two.md", "See [One](../a/one.md#summary).\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toContain("../b/one.md#summary");
  });

  it("keeps a markdown link's title", () => {
    note("a/one.md", "# One\n");
    note("c/two.md", 'See [One](../a/one.md "The One").\n');

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toContain('../b/one.md "The One"');
  });

  // A path inside a fence is an example, not a link. Rewriting it edits prose
  // that happens to look like a reference.
  it("leaves a link alone inside a fenced or inline code block", () => {
    note("a/one.md", "# One\n");
    note("c/two.md", "Real [One](../a/one.md).\n\n```\n[One](../a/one.md)\n```\n\nInline `[[a/one]]` too.\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    const body = applied("c/two.md", plan) ?? "";
    expect(body).toContain("Real [One](../b/one.md)");
    expect(body).toContain("```\n[One](../a/one.md)\n```");
    expect(body).toContain("`[[a/one]]`");
  });

  it("rewrites a moving file's own relative links to files that are not moving", () => {
    note("a/one.md", "Neighbour: [Two](../c/two.md)\n");
    note("c/two.md", "# Two\n");

    const plan = planMove(root, "a/one.md", "b/deep/one.md");
    if ("error" in plan) throw new Error(plan.error);
    // From b/deep/ the same file is three levels up, not one.
    expect(applied("b/deep/one.md", plan)).toContain("../../c/two.md");
  });
});
