import { describe, it, expect } from "vitest";
import { noteMetaFromContent, parseNote, splitBody } from "./note";

const RESTRICTED = `---
title: Exec Comp Plan
type: canon
updated: 2026-07-01
owner: nick@example.com
visibility: exec
---

# Exec Comp Plan

Body text.
`;

const ALL_HANDS = `---
title: Product Vision
---

Vision body.
`;

describe("note metadata", () => {
  it("reads header fields and a restricted visibility with a prettified group", () => {
    const meta = noteMetaFromContent("03-exec/comp.md", RESTRICTED);
    expect(meta.title).toBe("Exec Comp Plan");
    expect(meta.type).toBe("canon");
    expect(meta.updated).toBe("2026-07-01");
    expect(meta.owner).toBe("nick@example.com");
    expect(meta.visibility).toBe("restricted");
    expect(meta.group).toBe("Exec");
  });

  it("defaults to all-hands visibility with no group", () => {
    const meta = noteMetaFromContent("00-overview/vision.md", ALL_HANDS);
    expect(meta.visibility).toBe("all-hands");
    expect(meta.group).toBeUndefined();
  });

  it("derives a humanized title from the filename when frontmatter and heading are absent", () => {
    const meta = noteMetaFromContent("misc/quarterly-notes.md", "just a paragraph");
    expect(meta.title).toBe("Quarterly Notes");
  });

  it("prefers a body heading over the filename, verbatim", () => {
    const meta = noteMetaFromContent("misc/quarterly-notes.md", "# q3 planning notes\n\nbody");
    expect(meta.title).toBe("q3 planning notes");
  });

  it("splits the body from the frontmatter", () => {
    expect(splitBody(ALL_HANDS).trim()).toBe("Vision body.");
    expect(splitBody("no frontmatter here").trim()).toBe("no frontmatter here");
  });

  it("parseNote returns meta and body together", () => {
    const note = parseNote("03-exec/comp.md", RESTRICTED);
    expect(note.title).toBe("Exec Comp Plan");
    expect(note.body).toContain("# Exec Comp Plan");
    expect(note.body).toContain("Body text.");
  });
});

describe("noteMetaFromContent leaves authored titles alone", () => {
  it("does not title-case a frontmatter title that happens to match the file stem", () => {
    const content = "---\ntitle: quarterly notes\n---\n\nBody.\n";
    expect(noteMetaFromContent("reports/quarterly-notes.md", content).title).toBe("quarterly notes");
  });

  it("does not title-case an authored body heading that matches the file stem", () => {
    expect(noteMetaFromContent("reports/quarterly-notes.md", "# quarterly notes\n\nBody.\n").title)
      .toBe("quarterly notes");
  });

  it("still humanizes a note with neither a frontmatter title nor a heading", () => {
    expect(noteMetaFromContent("reports/quarterly-notes.md", "Body only.\n").title)
      .toBe("Quarterly Notes");
  });
});

describe("noteMetaFromContent names Meridian vault documents", () => {
  const TAG = (title: string) =>
    `<!-- KB-TAG v1 =====\nkb.id:    MERIDIAN-ECON-TOKEN\nkb.title: ${title}\nkb.learn: YES\n===== -->\n\n`;

  it("prefers kb.title over a first heading that is not a title", () => {
    const content = TAG("Meridian Tokenomics") + "# **1\\. Key Token Stats**\n\nBody.\n";
    expect(noteMetaFromContent("economics/Meridian_Tokenomics_v6_4.md", content).title)
      .toBe("Meridian Tokenomics");
  });

  it("falls back to the heading, stripped to text, when kb.title only echoes the stem", () => {
    const content = TAG("Meridian_Tokenomics_v6_4") + "# **1\\. Key Token Stats**\n\nBody.\n";
    expect(noteMetaFromContent("economics/Meridian_Tokenomics_v6_4.md", content).title)
      .toBe("1. Key Token Stats");
  });

  it("keeps a frontmatter title ahead of kb.title", () => {
    const content = "---\ntitle: Authored\n---\n\n" + TAG("From The Tag") + "# Heading\n";
    expect(noteMetaFromContent("economics/x.md", content).title).toBe("Authored");
  });

  it("leaves a meeting title plain, so the meetings and people views keep their own date column", () => {
    const content = `---\ntitle: "Acme Markets Daily Sync"\ntype: meeting\ndate: "2026-08-18T12:02:08.300Z"\n---\n\nNotes.\n`;
    expect(noteMetaFromContent("meetings/2026/acme-markets-daily-sync-44vrq.md", content).title)
      .toBe("Acme Markets Daily Sync");
  });
});
