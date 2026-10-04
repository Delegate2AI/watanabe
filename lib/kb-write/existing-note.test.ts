import { describe, expect, it } from "vitest";
import { mergeIntoExistingNote } from "./existing-note";

const EXISTING = `---
title: Risk Disclosure
type: policy
owner: maria@example.com
updated: 2026-07-02
tags:
  - risk
  - compliance
visibility:
  - c-level
---

The original prose.
`;

describe("mergeIntoExistingNote", () => {
  it("carries every frontmatter key through, changing only the title", () => {
    const result = mergeIntoExistingNote({ existing: EXISTING, title: "Risk Disclosure v2", body: "New prose." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toContain("title: Risk Disclosure v2");
    // The keys buildPublishedNote would have dropped on the floor.
    expect(result.note).toContain("owner: maria@example.com");
    expect(result.note).toContain("updated: 2026-07-02");
    expect(result.note).toContain("- risk");
    expect(result.note).toContain("- compliance");
    // A non-`note` type survives: buildPublishedNote hard-codes `type: note`.
    expect(result.note).toContain("type: policy");
    expect(result.note).toContain("New prose.");
    expect(result.note).not.toContain("The original prose.");
  });

  it("never lets a publisher change who may read the note", () => {
    const result = mergeIntoExistingNote({ existing: EXISTING, title: "Risk Disclosure", body: "New prose." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Visibility is not a parameter of this function at all, so there is no
    // value a caller could pass that would widen a restricted note.
    expect(result.note).toContain("- c-level");
    expect(result.note).not.toContain("all-hands");
  });

  it("refuses unparseable frontmatter instead of republishing it as all-hands", () => {
    const broken = "---\ntitle: Broken\nvisibility: [unclosed\n---\n\nBody.\n";

    const result = mergeIntoExistingNote({ existing: broken, title: "Broken", body: "New." });

    // The old path would have written a fresh all-hands header over a note only
    // admins can see. Failing closed costs one manual edit; failing open leaks.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("could not be parsed");
  });

  it("adds no clearance decision to a note that never carried one", () => {
    const result = mergeIntoExistingNote({ existing: "# Plain\n\nNo frontmatter here.\n", title: "Plain", body: "New." });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBe("New.\n");
    expect(result.note).not.toContain("visibility");
    expect(result.note).not.toContain("---");
  });

  it("strips a body that arrived with its own frontmatter, so the note never has two blocks", () => {
    const result = mergeIntoExistingNote({
      existing: EXISTING,
      title: "Risk Disclosure",
      body: "---\ntitle: Stale\nvisibility:\n  - all-hands\n---\n\nActual prose.\n",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toContain("Actual prose.");
    expect(result.note).not.toContain("Stale");
    // The smuggled visibility must not survive into the published note.
    expect(result.note).not.toContain("all-hands");
    expect(result.note.match(/^---$/gm)).toHaveLength(2);
  });
});
