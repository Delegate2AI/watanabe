import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planMove } from "./move";

/**
 * Assets move too, and the embeds pointing at them are links like any other.
 * Held apart from `move.test.ts` because the markdown-only case is already long
 * enough on its own.
 */

let root: string;

function file(rel: string, body: string): void {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function applied(rel: string, plan: Extract<ReturnType<typeof planMove>, { renames: unknown }>): string | undefined {
  return plan.rewrites.find((r) => r.path === rel)?.content;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "move-assets-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("planMove over non-markdown targets", () => {
  it("rewrites an embed written as a bare filename beside the note", () => {
    file("score/chart.png", "binary");
    file("score/stage-1.md", "![One rule, every archetype](chart.png)\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("](../assets/chart.png)");
  });

  it("rewrites relative and root-absolute embeds from elsewhere in the vault", () => {
    file("score/chart.png", "binary");
    file("notes/deep/ref.md", "![Chart](../../score/chart.png)\n");
    file("notes/abs.md", "![Chart](/score/chart.png)\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("notes/deep/ref.md", plan)).toContain("](../../assets/chart.png)");
    expect(applied("notes/abs.md", plan)).toContain("](/assets/chart.png)");
  });

  it("rewrites a wikilink embed and keeps the extension on it", () => {
    file("score/chart.png", "binary");
    file("score/stage-1.md", "![[score/chart.png]]\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("[[assets/chart.png]]");
  });

  it("carries the assets inside a moved directory into the link mapping", () => {
    file("score/chart.png", "binary");
    file("score/notes.md", "# Notes\n");
    file("outside/ref.md", "![Chart](../score/chart.png) and [notes](../score/notes.md)\n");

    const plan = planMove(root, "score", "archive/score");
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.renames).toContainEqual({ from: "score/chart.png", to: "archive/score/chart.png" });
    const rewritten = applied("outside/ref.md", plan);
    expect(rewritten).toContain("../archive/score/chart.png");
    expect(rewritten).toContain("../archive/score/notes.md");
  });

  it("leaves an embed inside a code span alone", () => {
    file("score/chart.png", "binary");
    file("score/stage-1.md", "Write it as `![Chart](chart.png)` in your note.\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toBeUndefined();
  });

  it("leaves an unrelated asset reference alone", () => {
    file("score/chart.png", "binary");
    file("score/other.png", "binary");
    file("score/stage-1.md", "![Other](other.png)\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toBeUndefined();
  });

  it("rewrites a bare wikilink embed naming a sibling of the note", () => {
    file("score/chart.png", "binary");
    file("score/stage-1.md", "![[chart.png]]\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("[[assets/chart.png]]");
  });

  it("percent-encodes a destination whose name would break the link syntax", () => {
    file("score/chart one.png", "binary");
    file("score/stage-1.md", "![Chart](chart%20one.png)\n");

    const plan = planMove(root, "score/chart one.png", "assets/chart one.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("](../assets/chart%20one.png)");
  });

  it("leaves an href that climbs above the vault root alone", () => {
    file("score/chart.png", "binary");
    file("notes/ref.md", "![Outside](../../../score/chart.png)\n");

    const plan = planMove(root, "score/chart.png", "assets/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("notes/ref.md", plan)).toBeUndefined();
  });

  it("resolves a bare wikilink by filename across the vault, as Obsidian does", () => {
    file("a/one.md", "# One\n");
    file("c/two.md", "See [[one]] for detail.\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toContain("[[b/one]]");
  });

  it("leaves an ambiguous bare wikilink alone rather than guessing", () => {
    file("a/one.md", "# One\n");
    file("z/one.md", "# Also one\n");
    file("c/two.md", "See [[one]] for detail.\n");

    const plan = planMove(root, "a/one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toBeUndefined();
  });

  // encodeURIComponent leaves parentheses alone, and a raw ")" ends the
  // destination early, so they are escaped explicitly.
  it("percent-encodes parentheses in the destination it emits", () => {
    file("score/chart(one).png", "binary");
    file("score/stage-1.md", "![Chart](chart%28one%29.png)\n");

    const plan = planMove(root, "score/chart(one).png", "assets/chart(one).png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("](../assets/chart%28one%29.png)");
  });

  it("leaves a bare wikilink alone when a root-level file shares the name", () => {
    file("one.md", "# Root one\n");
    file("z/one.md", "# Also one\n");
    file("c/two.md", "See [[one]] for detail.\n");

    const plan = planMove(root, "one.md", "b/one.md");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("c/two.md", plan)).toBeUndefined();
  });

  it("leaves a bare wikilink alone when a sibling shares the name", () => {
    file("score/chart.png", "binary");
    file("assets/chart.png", "binary");
    file("score/stage-1.md", "![[chart.png]]\n");

    const plan = planMove(root, "score/chart.png", "archive/chart.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toBeUndefined();
  });

  it("percent-encodes a hash in a filename rather than emitting a fragment", () => {
    file("score/a#b.png", "binary");
    file("score/stage-1.md", "![Chart](a%23b.png)\n");

    const plan = planMove(root, "score/a#b.png", "assets/a#b.png");
    if ("error" in plan) throw new Error(plan.error);
    expect(applied("score/stage-1.md", plan)).toContain("](../assets/a%23b.png)");
  });
});
