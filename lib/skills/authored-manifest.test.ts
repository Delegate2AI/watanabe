import { describe, expect, it } from "vitest";
import { buildSkillManifest, manifestRev, parseSkillManifest } from "./authored-manifest";

describe("buildSkillManifest and parseSkillManifest", () => {
  it("round-trips name, description, and body", () => {
    const manifest = buildSkillManifest("Release Notes", "How to write them", "Do the thing.");

    expect(parseSkillManifest(manifest)).toEqual({
      ok: true,
      name: "Release Notes",
      description: "How to write them",
      body: "Do the thing.",
    });
  });

  it("keeps a description containing quotes, colons, newlines, and a dashed line out of the frontmatter structure", () => {
    const description = 'She said: "use --- carefully"\nsecond line';
    const manifest = buildSkillManifest("Tricky One", description, "Body text.");

    const parsed = parseSkillManifest(manifest);
    expect(parsed).toEqual({ ok: true, name: "Tricky One", description, body: "Body text." });
    const frontLines = manifest.split("\n");
    expect(frontLines[0]).toBe("---");
    expect(frontLines[3]).toBe("---");
  });

  it("refuses a manifest without frontmatter", () => {
    expect(parseSkillManifest("just a body")).toEqual({ ok: false });
  });

  it("refuses unterminated frontmatter", () => {
    expect(parseSkillManifest('---\nname: "X"\ndescription: "Y"')).toEqual({ ok: false });
  });

  it("refuses frontmatter missing a name or description", () => {
    expect(parseSkillManifest('---\nname: "X"\n---\nbody')).toEqual({ ok: false });
  });

  it("derives the rev as the first 12 hex characters of the manifest's sha256", () => {
    const manifest = buildSkillManifest("A", "B", "C");

    const rev = manifestRev(manifest);
    expect(rev).toMatch(/^[0-9a-f]{12}$/);
    expect(manifestRev(manifest)).toBe(rev);
    expect(manifestRev(manifest + " ")).not.toBe(rev);
  });
});
