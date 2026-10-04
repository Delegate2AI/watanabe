import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildKbTree, type KbTreeNode } from "./tree";

/**
 * These tests build a fixture "projection" directory directly and pass it as
 * the root. That mirrors the real call site (`vaultRootFor(clearance)`): the
 * tree only ever sees the notes that were projected for the requester, so an
 * exec-only note is simply not written into an all-hands fixture.
 */
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-tree-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function flatten(nodes: KbTreeNode[]): string[] {
  return nodes.flatMap((n) => [n.routeSlug.join("/"), ...(n.children ? flatten(n.children) : [])]);
}

describe("buildKbTree", () => {
  it("nests directories and files, with extensionless route slugs", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    write("00-overview/goals.md", "---\ntitle: Goals\n---\nbody");

    const tree = buildKbTree(root);
    const overview = tree.find((n) => n.path === "00-overview");
    expect(overview?.isDirectory).toBe(true);
    const files = (overview?.children ?? []).map((c) => c.routeSlug.join("/"));
    expect(files).toContain("00-overview/vision");
    expect(files).toContain("00-overview/goals");
  });

  it("chips a restricted-but-present note and leaves all-hands notes unchipped", () => {
    write("exec/comp.md", "---\ntitle: Comp\nvisibility: exec\n---\nbody");
    write("public/readme.md", "---\ntitle: Readme\n---\nbody");

    const tree = buildKbTree(root);
    const comp = tree.find((n) => n.path === "exec")?.children?.[0];
    const readme = tree.find((n) => n.path === "public")?.children?.[0];
    expect(comp?.visibility).toBe("restricted");
    expect(comp?.group).toBe("Exec");
    expect(readme?.visibility).toBe("all-hands");
    expect(readme?.group).toBeUndefined();
  });

  it("an exec-only note is absent from an all-hands projection tree", () => {
    // The all-hands projection simply never contains the exec note on disk.
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    const tree = buildKbTree(root);
    expect(flatten(tree)).not.toContain("exec/comp");
    expect(flatten(tree)).toContain("00-overview/vision");
  });

  it("carries the vault-relative path on file and directory nodes", () => {
    write("09-finance/fees.md", "---\ntitle: Fees\n---\nbody");

    const tree = buildKbTree(root);
    const finance = tree.find((n) => n.path === "09-finance");
    expect(finance?.path).toBe("09-finance");
    expect(finance?.children?.find((c) => c.path === "09-finance/fees.md")?.path).toBe(
      "09-finance/fees.md",
    );
  });

  it("names a file node by its frontmatter title, leaving the route slug and path alone", () => {
    write("04-economy/tokenomics.md", "---\ntitle: Emission Design\n---\nemission curves");

    const note = buildKbTree(root).find((n) => n.path === "04-economy")?.children?.[0];
    expect(note?.name).toBe("Emission Design");
    // The regression guard: URLs, wikilinks, and backlinks all key off these.
    expect(note?.routeSlug).toEqual(["04-economy", "tokenomics"]);
    expect(note?.path).toBe("04-economy/tokenomics.md");
  });

  it("names a title-less file node by its humanized stem, leaving the route slug and path alone", () => {
    write("misc/onboarding-handbook.md", "just a paragraph, no frontmatter and no heading");

    const note = buildKbTree(root).find((n) => n.path === "misc")?.children?.[0];
    expect(note?.name).toBe("Onboarding Handbook");
    expect(note?.routeSlug).toEqual(["misc", "onboarding-handbook"]);
    expect(note?.path).toBe("misc/onboarding-handbook.md");
  });

  it("strips a numeric sort prefix from a directory name for display only", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    write("meetings/standup.md", "---\ntitle: Standup\n---\nbody");

    const tree = buildKbTree(root);
    const overview = tree.find((n) => n.path === "00-overview");
    const meetings = tree.find((n) => n.path === "meetings");
    expect(overview?.name).toBe("Overview");
    expect(meetings?.name).toBe("Meetings");
    // Display only: the slug and path still carry the on-disk name.
    expect(overview?.routeSlug).toEqual(["00-overview"]);
    expect(overview?.path).toBe("00-overview");
  });

  it("renders a shouted directory name as a word, keeping short acronyms intact", () => {
    write("99-REFERENCE/glossary.md", "---\ntitle: Glossary\n---\nbody");
    write("KPI/north-star.md", "---\ntitle: North Star\n---\nbody");

    const tree = buildKbTree(root);
    expect(tree.find((n) => n.path === "99-REFERENCE")?.name).toBe("Reference");
    expect(tree.find((n) => n.path === "KPI")?.name).toBe("KPI");
  });
});

describe("buildKbTree names and orders meeting notes", () => {
  const meetingNote = (date: string) =>
    `---\ntitle: "Acme Markets Daily Sync"\ntype: meeting\ndate: "${date}"\n---\n\nNotes.\n`;

  it("dates a recurring meeting and lists it newest first, whatever the filenames say", () => {
    // Filenames are title plus an opaque ingest id, so their order says nothing
    // about time: here the alphabetically first file is the oldest meeting.
    write("meetings/a.md", meetingNote("2026-08-12T09:00:00Z"));
    write("meetings/b.md", meetingNote("2026-08-18T12:00:00Z"));
    write("meetings/c.md", meetingNote("2026-08-14T12:30:00Z"));

    const meetings = buildKbTree(root).find((n) => n.path === "meetings");
    expect(meetings?.children?.map((child) => child.name)).toEqual([
      "18 Aug 12:00 · Acme Markets Daily Sync",
      "14 Aug 12:30 · Acme Markets Daily Sync",
      "12 Aug 09:00 · Acme Markets Daily Sync",
    ]);
  });

  it("names a meeting with the short stamp and keeps the full stamp for the tooltip", () => {
    write("meetings/2026/sync.md", meetingNote("2026-08-18T12:00:00Z"));
    write("meetings/2026/agenda.md", "---\ntitle: Agenda\n---\nbody");

    const year = buildKbTree(root).find((n) => n.path === "meetings")?.children?.[0];
    const [sync, agenda] = year?.children ?? [];
    expect(sync).toMatchObject({
      name: "18 Aug 12:00 · Acme Markets Daily Sync",
      tooltip: "2026-08-18 12:00 UTC · Acme Markets Daily Sync",
    });
    expect(agenda?.name).toBe("Agenda");
    expect(agenda?.tooltip).toBeUndefined();
  });

  it("keeps subdirectories first and undated notes after the dated ones, in filename order", () => {
    write("meetings/2025/old.md", meetingNote("2025-12-01T10:00:00Z"));
    write("meetings/zz-agenda.md", "---\ntitle: Agenda\n---\nbody");
    write("meetings/aa-template.md", "---\ntitle: Template\n---\nbody");
    write("meetings/sync.md", meetingNote("2026-08-18T12:00:00Z"));

    const meetings = buildKbTree(root).find((n) => n.path === "meetings");
    expect(meetings?.children?.map((child) => child.path)).toEqual([
      "meetings/2025",
      "meetings/sync.md",
      "meetings/aa-template.md",
      "meetings/zz-agenda.md",
    ]);
  });
});
