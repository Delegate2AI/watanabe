import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { MAX_DESIGN_GUIDE_BYTES } from "./config";
import { invalidateDesignGuideCache, loadDesignGuide, type DesignGuide } from "./store";

/**
 * The read half of the admin-editable house style.
 *
 * Its only real contract is that it always returns usable guidance. It sits on
 * the system-prompt path, so a throw takes down a session and a blank answer
 * produces exactly the undesigned page the guidance exists to prevent. Every
 * failure below has to land on the shipped constant.
 */

let dir = "";
const guidePath = () => path.join(dir, "design-guide.md");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "design-guide-"));
  invalidateDesignGuideCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  invalidateDesignGuideCache();
});

describe("loadDesignGuide", () => {
  it("is the shipped guide when no admin has ever edited one", () => {
    const guide = loadDesignGuide(guidePath());
    expect(guide.text).toBe(DEFAULT_DESIGN_HOUSE_STYLE);
    expect(guide.source).toBe("default");
  });

  it("is the stored guide once one is committed", () => {
    writeFileSync(guidePath(), "HOUSE STYLE\n\nEverything is a table.\n");
    const guide = loadDesignGuide(guidePath());
    expect(guide.text).toBe("HOUSE STYLE\n\nEverything is a table.");
    expect(guide.source).toBe("stored");
  });

  it("falls back to the shipped guide for an empty file, rather than to no guidance", () => {
    // An emptied file is the one edit that would otherwise produce a system
    // prompt with constraints and no art direction, which is the white-page
    // failure. The write path refuses to save one; this covers a file emptied
    // on the ref by hand.
    writeFileSync(guidePath(), "   \n\n");
    expect(loadDesignGuide(guidePath()).source).toBe("default");
  });

  it("refuses a file that grew past the ceiling on the ref", () => {
    writeFileSync(guidePath(), "x".repeat(MAX_DESIGN_GUIDE_BYTES + 1));
    expect(loadDesignGuide(guidePath()).source).toBe("default");
  });

  it("never throws when the file cannot be read", () => {
    writeFileSync(guidePath(), "HOUSE STYLE\n");
    chmodSync(guidePath(), 0o000);
    let guide: DesignGuide | undefined;
    expect(() => {
      guide = loadDesignGuide(guidePath());
    }).not.toThrow();
    // Root ignores the mode, so this asserts only the never-throws contract and
    // that whatever came back is usable guidance.
    expect(guide?.text.trim()).not.toBe("");
    chmodSync(guidePath(), 0o600);
  });

  it("picks up an edit once the cache is invalidated", () => {
    writeFileSync(guidePath(), "HOUSE STYLE\n\nFirst.\n");
    expect(loadDesignGuide(guidePath()).text).toContain("First.");
    writeFileSync(guidePath(), "HOUSE STYLE\n\nSecond.\n");
    invalidateDesignGuideCache();
    expect(loadDesignGuide(guidePath()).text).toContain("Second.");
  });

  it("falls back when the committed guide would not have passed the save route", () => {
    // The file is on a git ref, so a commit made by hand never went through a
    // route. Guidance that contradicts the constraints is worse than none.
    writeFileSync(guidePath(), "HOUSE STYLE\n\nAdd <script> for interactivity.\n");
    expect(loadDesignGuide(guidePath()).source).toBe("default");
  });

  it("treats a guide of zero-width spaces as no guide", () => {
    writeFileSync(guidePath(), "​​⁠\n");
    expect(loadDesignGuide(guidePath()).source).toBe("default");
  });

  it("does not serve one path's guide from another path's cache slot", () => {
    const other = path.join(dir, "other.md");
    writeFileSync(guidePath(), "HOUSE STYLE\n\nMine.\n");
    writeFileSync(other, "HOUSE STYLE\n\nTheirs.\n");
    expect(loadDesignGuide(guidePath()).text).toContain("Mine.");
    expect(loadDesignGuide(other).text).toContain("Theirs.");
  });
});
