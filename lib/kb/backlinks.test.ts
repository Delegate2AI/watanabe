import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backlinksFor } from "./backlinks";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-backlinks-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("backlinksFor", () => {
  it("lists in-projection notes that link to the target", () => {
    write("vision.md", "---\ntitle: Vision\n---\n# Vision");
    write("roadmap.md", "---\ntitle: Roadmap\n---\nSee [vision](vision.md).");

    const links = backlinksFor("vision.md", root);
    expect(links).toEqual([{ route: "roadmap", title: "Roadmap" }]);
  });

  it("resolves wikilink referrers too", () => {
    write("vision.md", "---\ntitle: Vision\n---\n# Vision");
    write("plan.md", "---\ntitle: Plan\n---\nRef [[vision]].");

    const links = backlinksFor("vision.md", root);
    expect(links.map((l) => l.route)).toContain("plan");
  });

  it("returns nothing for a note with no referrers", () => {
    write("vision.md", "---\ntitle: Vision\n---\n# Vision");
    expect(backlinksFor("vision.md", root)).toEqual([]);
  });

  it("never surfaces an out-of-projection referrer (it is absent from the root)", () => {
    // The exec note that would reference vision is simply not in this projection.
    write("vision.md", "---\ntitle: Vision\n---\n# Vision");
    write("public.md", "---\ntitle: Public\n---\nSee [vision](vision.md).");
    const links = backlinksFor("vision.md", root);
    expect(links.map((l) => l.route)).toEqual(["public"]);
  });
});
