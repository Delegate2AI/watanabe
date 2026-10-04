import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { searchKb } from "./search";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-search-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("searchKb", () => {
  it("returns clearance-scoped rows with title, route, visibility, and snippet", async () => {
    write("00-overview/vision.md", "---\ntitle: Product Vision\n---\nThe north star metric is retention.");
    const rows = await searchKb("north star", root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      route: "00-overview/vision",
      title: "Product Vision",
      visibility: "all-hands",
    });
    expect(rows[0].snippet.toLowerCase()).toContain("north star");
  });

  it("collapses multiple matching lines in one note to a single row", async () => {
    write("notes.md", "---\ntitle: Notes\n---\nalpha here\nalpha again\nalpha thrice");
    const rows = await searchKb("alpha", root);
    expect(rows).toHaveLength(1);
  });

  it("carries the restricted chip for a restricted-but-present note", async () => {
    write("exec/comp.md", "---\ntitle: Comp\nvisibility: exec\n---\nsalary bands here");
    const rows = await searchKb("salary bands", root);
    expect(rows[0].visibility).toBe("restricted");
    expect(rows[0].group).toBe("Exec");
  });

  it("never returns a restricted note absent from the scoped root", async () => {
    // The exec note is not written into this projection, so its match cannot appear.
    write("public.md", "---\ntitle: Public\n---\nquota targets");
    const rows = await searchKb("quota targets", root);
    expect(rows.map((r) => r.route)).toEqual(["public"]);
  });

  it("returns nothing for an empty query", async () => {
    expect(await searchKb("   ", root)).toEqual([]);
  });

  it("never snippets the frontmatter block", async () => {
    write(
      "04-economy/tokenomics.md",
      "---\ntitle: Emission Design\nowner: maria.chen@example.com\n---\n## Interaction with emissions\n\nEmission curves are set annually.",
    );
    const rows = await searchKb("emission curves", root);
    expect(rows).toHaveLength(1);
    expect(rows[0].snippet).not.toContain("owner:");
    expect(rows[0].snippet).not.toContain("maria.chen@example.com");
    expect(rows[0].snippet).toContain("Emission curves are set annually.");
  });

  it("does not open a snippet with the title the card already renders", async () => {
    write("04-economy/tokenomics.md", "---\ntitle: Emission Design\n---\n# Emission Design\n\nRestricted to finance.");
    const rows = await searchKb("restricted", root);
    expect(rows[0].snippet).toBe("Restricted to finance.");
  });

  it("renders a matched table row as prose, not pipes", async () => {
    write("INDEX.md", "---\ntitle: Index\n---\n| `04-economy` | Emissions, fees, treasury | finance |");
    const rows = await searchKb("treasury", root);
    expect(rows[0].snippet).toBe("04-economy Emissions, fees, treasury finance");
  });

  it("does not return a note that only lists the query as its owner", async () => {
    write("04-economy/tokenomics.md", "---\ntitle: Emission Design\nowner: maria.chen@example.com\n---\nEmission curves.");
    write("people/maria.md", "---\ntitle: Maria Chen\n---\nHead of finance.");
    const rows = await searchKb("maria", root);
    expect(rows.map((r) => r.route)).toEqual(["people/maria"]);
  });

  it("keeps a title match even when the body never says the word", async () => {
    write("04-economy/tokenomics.md", "---\ntitle: Emission Design\n---\nCurves are set annually.");
    const rows = await searchKb("emission design", root);
    expect(rows.map((r) => r.route)).toEqual(["04-economy/tokenomics"]);
    // No body occurrence to center on, so the snippet falls back to the head.
    expect(rows[0].snippet).toContain("Curves are set annually.");
  });

  it("ranks a title match above a body-only match", async () => {
    write("a-body.md", "---\ntitle: Fee Schedule\n---\nThe treasury absorbs the shortfall.");
    write("b-title.md", "---\ntitle: Treasury Policy\n---\nReserves are held quarterly.");
    const rows = await searchKb("treasury", root);
    expect(rows.map((r) => r.route)).toEqual(["b-title", "a-body"]);
  });

  it("dates meeting rows and orders them newest first among themselves", async () => {
    const meetingNote = (date: string) =>
      `---\ntitle: "Daily Sync"\ntype: meeting\ndate: "${date}"\n---\nWe discussed the treasury.`;
    // Filenames carry an opaque ingest id, so their order is not time order.
    write("meetings/2026/daily-sync-aaa.md", meetingNote("2026-08-12T12:00:00Z"));
    write("meetings/2026/daily-sync-bbb.md", meetingNote("2026-08-18T12:00:00Z"));
    write("meetings/2026/daily-sync-ccc.md", meetingNote("2026-08-14T12:00:00Z"));

    const rows = await searchKb("treasury", root);
    expect(rows.map((r) => r.title)).toEqual([
      "2026-08-18 12:00 UTC · Daily Sync",
      "2026-08-14 12:00 UTC · Daily Sync",
      "2026-08-12 12:00 UTC · Daily Sync",
    ]);
  });

  it("keeps a title match ahead of dated meeting rows that only mention the term", async () => {
    const meetingNote = (date: string) =>
      `---\ntitle: "Daily Sync"\ntype: meeting\ndate: "${date}"\n---\nThe treasury absorbs the shortfall.`;
    write("meetings/2026/daily-sync-aaa.md", meetingNote("2026-08-12T12:00:00Z"));
    write("meetings/2026/daily-sync-bbb.md", meetingNote("2026-08-18T12:00:00Z"));
    write("zz-policy.md", "---\ntitle: Treasury Policy\n---\nReserves are held quarterly.");

    const rows = await searchKb("treasury", root);
    expect(rows.map((r) => r.route)).toEqual([
      "zz-policy",
      "meetings/2026/daily-sync-bbb",
      "meetings/2026/daily-sync-aaa",
    ]);
  });

  it("never lets a newer body-only meeting outrank an older meeting the query names", async () => {
    write(
      "meetings/2026/daily-sync-aaa.md",
      '---\ntitle: "Daily Sync"\ntype: meeting\ndate: "2026-08-12T12:00:00Z"\n---\nStandup notes.',
    );
    write(
      "meetings/2026/planning-bbb.md",
      '---\ntitle: "Sprint Planning"\ntype: meeting\ndate: "2026-08-18T12:00:00Z"\n---\nWe will sync on Friday.',
    );

    const rows = await searchKb("sync", root);
    expect(rows.map((r) => r.route)).toEqual([
      "meetings/2026/daily-sync-aaa",
      "meetings/2026/planning-bbb",
    ]);
  });

  it("carries match offsets so the UI can mark the term", async () => {
    write("notes.md", "---\ntitle: Notes\n---\nThe north star metric is retention.");
    const rows = await searchKb("north star", root);
    expect(rows[0].snippet.slice(rows[0].matchStart, rows[0].matchEnd)).toBe("north star");
  });
});
