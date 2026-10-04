import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangedPath } from "@/lib/git-host";

const readVaultFileMock = vi.fn<(rel: string, root: string) => string | null>();
vi.mock("@/lib/vault", () => ({ readVaultFile: (r: string, root: string) => readVaultFileMock(r, root) }));
vi.mock("@/lib/repo", () => ({ unfilteredVaultRoot: () => "/vault" }));
vi.mock("@/lib/authority/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authority/groups")>()),
  loadGroups: () => ({ admins: ["boss@example.com"], traders: ["alice@example.com"] }),
}));

const { VAULT_PREFIX, touchesOnlyVault, visibilityOfChange, clearedForChanges } = await import("./clearance");

function change(over: Partial<ChangedPath> = {}): ChangedPath {
  return {
    oldPath: "docs/a.md",
    newPath: "docs/a.md",
    diff: "",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    ...over,
  };
}

beforeEach(() => readVaultFileMock.mockReset());

describe("touchesOnlyVault", () => {
  it("accepts a change confined to docs/", () => {
    expect(VAULT_PREFIX).toBe("docs/");
    expect(touchesOnlyVault([change()])).toBe(true);
  });

  it("rejects an MR that mixes a vault path with a deploy path", () => {
    expect(touchesOnlyVault([change(), change({ newPath: "helm/envs/prod/app.yaml" })])).toBe(false);
  });

  it("rejects a path that escapes docs/ by traversal or by prefix collision", () => {
    expect(touchesOnlyVault([change({ newPath: "docs/../access/roles.yaml" })])).toBe(false);
    expect(touchesOnlyVault([change({ newPath: "docsx/a.md" })])).toBe(false);
    expect(touchesOnlyVault([change({ newPath: "../docs/a.md" })])).toBe(false);
  });

  it("rejects an absolute path and the bare prefix", () => {
    expect(touchesOnlyVault([change({ newPath: "/docs/a.md" })])).toBe(false);
    expect(touchesOnlyVault([change({ newPath: "docs/" })])).toBe(false);
    expect(touchesOnlyVault([change({ newPath: "" })])).toBe(false);
  });

  it("rejects an empty change set", () => {
    expect(touchesOnlyVault([])).toBe(false);
  });

  it("checks the old path too, so a rename out of the vault cannot pass", () => {
    expect(touchesOnlyVault([change({ oldPath: "helm/a.yaml", newPath: "docs/a.md", renamedFile: true })])).toBe(false);
    expect(touchesOnlyVault([change({ oldPath: "docs/a.md", newPath: "helm/a.yaml", renamedFile: true })])).toBe(false);
  });
});

describe("visibilityOfChange", () => {
  it("reads an existing note's visibility from the unfiltered vault", () => {
    readVaultFileMock.mockReturnValue("---\nvisibility: [traders]\n---\nbody");
    expect(visibilityOfChange(change())).toEqual(["traders"]);
    expect(readVaultFileMock).toHaveBeenCalledWith("a.md", "/vault");
  });

  it("reads a new note's visibility out of the diff, since it is not on main yet", () => {
    const diff = "@@ -0,0 +1,4 @@\n+---\n+visibility: [traders]\n+---\n+body\n";
    expect(visibilityOfChange(change({ newFile: true, diff }))).toEqual(["traders"]);
    expect(readVaultFileMock).not.toHaveBeenCalled();
  });

  it("reads a deleted note's visibility from main, by its old path", () => {
    readVaultFileMock.mockReturnValue("---\nvisibility: [traders]\n---\nbody");
    expect(visibilityOfChange(change({ oldPath: "docs/gone.md", newPath: "docs/gone.md", deletedFile: true })))
      .toEqual(["traders"]);
    expect(readVaultFileMock).toHaveBeenCalledWith("gone.md", "/vault");
  });

  it("is unparseable when the note is gone from main and is not a new file", () => {
    readVaultFileMock.mockReturnValue(null);
    expect(visibilityOfChange(change())).toBe("unparseable");
  });

  it("is unparseable when a new file carries no frontmatter", () => {
    expect(visibilityOfChange(change({ newFile: true, diff: "@@ -0,0 +1 @@\n+body\n" }))).toBe("unparseable");
  });

  it("is unparseable when a new file's frontmatter does not parse", () => {
    const diff = "@@ -0,0 +1,3 @@\n+---\n+visibility: nonsense: [\n+---\n";
    expect(visibilityOfChange(change({ newFile: true, diff }))).toBe("unparseable");
  });

  it("defaults an existing note with no visibility field to all-hands", () => {
    readVaultFileMock.mockReturnValue("---\ntitle: A\n---\nbody");
    expect(visibilityOfChange(change())).toEqual(["all-hands"]);
  });

  it("reads a renamed note's visibility from the path it still has on main", () => {
    readVaultFileMock.mockImplementation((rel: string) =>
      rel === "old.md" ? "---\nvisibility: [traders]\n---\n" : null,
    );
    expect(
      visibilityOfChange(change({ oldPath: "docs/old.md", newPath: "docs/new.md", renamedFile: true })),
    ).toEqual(["traders"]);
  });
});

describe("clearedForChanges", () => {
  it("clears a member for a note their group can see", () => {
    readVaultFileMock.mockReturnValue("---\nvisibility: [traders]\n---\n");
    expect(clearedForChanges("alice@example.com", [change()])).toBe(true);
  });

  it("refuses a member for a note outside their clearance", () => {
    readVaultFileMock.mockReturnValue("---\nvisibility: [board]\n---\n");
    expect(clearedForChanges("alice@example.com", [change()])).toBe(false);
  });

  it("refuses when only one of several notes is outside their clearance", () => {
    readVaultFileMock.mockImplementation((rel) =>
      rel === "a.md" ? "---\nvisibility: [traders]\n---\n" : "---\nvisibility: [board]\n---\n");
    expect(clearedForChanges("alice@example.com", [change(), change({ oldPath: "docs/b.md", newPath: "docs/b.md" })]))
      .toBe(false);
  });

  it("clears an admin for everything, including an unparseable note", () => {
    readVaultFileMock.mockReturnValue(null);
    expect(clearedForChanges("boss@example.com", [change()])).toBe(true);
  });

  it("refuses a non-admin an unparseable note", () => {
    readVaultFileMock.mockReturnValue("---\nvisibility: nonsense: [\n---\n");
    expect(clearedForChanges("alice@example.com", [change()])).toBe(false);
  });

  it("refuses an empty change set, as touchesOnlyVault does", () => {
    expect(clearedForChanges("boss@example.com", [])).toBe(false);
    expect(clearedForChanges("alice@example.com", [])).toBe(false);
  });
});
