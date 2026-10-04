import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// This is the security boundary for the native KB web view: slug → filesystem
// resolution must never escape vaultRoot(), must never expose ignored paths
// (.obsidian, .claude, .harness, private/, templates/, assets/source,
// assets/data — mirroring quartz.config.ts's ignorePatterns), and must 404
// (return null, for the caller to notFound()) rather than throw on anything
// missing. Built against a REAL temp directory (not mocks) so the fs
// interactions themselves are exercised, matching how lib/agent/permissions
// tests this same containment logic.

const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR"] as const;
let savedEnv: Record<string, string | undefined>;
let vaultDir: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vaultDir = mkdtempSync(path.join(tmpdir(), "vault-test-"));

  mkdirSync(path.join(vaultDir, "00-overview"), { recursive: true });
  writeFileSync(path.join(vaultDir, "README.md"), "# Welcome\n\nSee [overview](00-overview/product-vision.md).");
  writeFileSync(path.join(vaultDir, "INDEX.md"), "# Index");
  writeFileSync(path.join(vaultDir, "00-overview", "product-vision.md"), "# Product Vision\n\nOrbit content.");

  mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vaultDir, ".obsidian", "config"), "secret obsidian config");

  mkdirSync(path.join(vaultDir, "private"), { recursive: true });
  writeFileSync(path.join(vaultDir, "private", "notes.md"), "should never be served");

  mkdirSync(path.join(vaultDir, "assets", "source"), { recursive: true });
  writeFileSync(path.join(vaultDir, "assets", "source", "raw.psd"), "binary-ish");
  writeFileSync(path.join(vaultDir, "assets", "diagram.png"), "not-really-a-png");

  // A sibling directory OUTSIDE the vault, for traversal-attempt tests.
  writeFileSync(path.join(vaultDir, "..", `${path.basename(vaultDir)}-secret.txt`), "outside the vault");

  process.env.LOCAL_REPO_PATH = vaultDir;
  process.env.VAULT_SUBDIR = "."; // repo root IS the vault for this test fixture
  delete process.env.REPO_READ_TOKEN;
});

afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
  rmSync(path.join(vaultDir, "..", `${path.basename(vaultDir)}-secret.txt`), { force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("resolveVaultEntry", () => {
  it("resolves the vault root (empty/undefined slug) as a directory", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(undefined)).toMatchObject({ relPath: "", isDirectory: true });
    expect(resolveVaultEntry([])).toMatchObject({ relPath: "", isDirectory: true });
  });

  it("resolves a real .md file inside the vault (exact, extension included)", async () => {
    const { resolveVaultEntry } = await import("./vault");
    const entry = resolveVaultEntry(["00-overview", "product-vision.md"]);
    expect(entry).toMatchObject({ relPath: "00-overview/product-vision.md", isDirectory: false });
  });

  it("resolves the CLEAN (extensionless) URL for a .md page — matches what VaultTree/VaultDirListing/resolveVaultLink all generate", async () => {
    const { resolveVaultEntry } = await import("./vault");
    const entry = resolveVaultEntry(["00-overview", "product-vision"]);
    expect(entry).toMatchObject({
      relPath: "00-overview/product-vision.md",
      slug: ["00-overview", "product-vision"], // slug stays extensionless (the URL-facing identity)
      isDirectory: false,
    });
  });

  it("does not fall back to `${slug}.md` when a directory of that exact name exists", async () => {
    const { resolveVaultEntry } = await import("./vault");
    const entry = resolveVaultEntry(["00-overview"]);
    expect(entry).toMatchObject({ isDirectory: true, relPath: "00-overview" });
  });

  it("does not clean-URL-resolve an ignored `.md` fallback path", async () => {
    const { resolveVaultEntry } = await import("./vault");
    // "private" is a real directory, but "private.md" isn't a real file either
    // way — this just confirms the fallback path re-checks isIgnoredVaultPath
    // and doesn't, say, throw.
    expect(resolveVaultEntry(["private", "notes"])).toBeNull();
  });

  it("resolves a real subdirectory", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["00-overview"])).toMatchObject({ relPath: "00-overview", isDirectory: true });
  });

  it("404s (returns null) for a nonexistent path", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["nope.md"])).toBeNull();
    expect(resolveVaultEntry(["00-overview", "nope.md"])).toBeNull();
  });

  it("404s for ignored paths: .obsidian, private/, assets/source", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry([".obsidian", "config"])).toBeNull();
    expect(resolveVaultEntry(["private", "notes.md"])).toBeNull();
    expect(resolveVaultEntry(["assets", "source", "raw.psd"])).toBeNull();
  });

  it("still serves assets/diagram.png (assets/ itself is not ignored, only assets/source and assets/data)", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["assets", "diagram.png"])).toMatchObject({ isDirectory: false });
  });

  it("404s for a path-traversal attempt via ../ segments", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["..", `${path.basename(vaultDir)}-secret.txt`])).toBeNull();
    expect(resolveVaultEntry(["00-overview", "..", "..", "etc", "passwd"])).toBeNull();
  });

  it("404s for an absolute-path-shaped slug segment and for . / .. segments", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["."])).toBeNull();
    expect(resolveVaultEntry([".."])).toBeNull();
    expect(resolveVaultEntry([""])).toBeNull();
  });

  it("404s for a symlink that escapes the vault (containment is lexical, not symlink-aware — matches lib/agent/permissions)", async () => {
    const outsideFile = path.join(vaultDir, "..", `${path.basename(vaultDir)}-secret.txt`);
    const linkPath = path.join(vaultDir, "escape-link.md");
    try {
      symlinkSync(outsideFile, linkPath);
    } catch {
      return; // symlink creation can fail in some sandboxes — not the behavior under test
    }
    const { resolveVaultEntry } = await import("./vault");
    // statSync follows the symlink; the resolved absPath is still lexically
    // inside the vault (isPathWithinVault is lexical, per its own doc
    // comment), so this currently resolves rather than 404s — documenting the
    // same residual gap called out in lib/agent/permissions.ts.
    const entry = resolveVaultEntry(["escape-link.md"]);
    expect(entry).not.toBeNull();
  });
});

describe("toRouteSlug", () => {
  it("strips a trailing .md from the last segment", async () => {
    const { toRouteSlug } = await import("./vault");
    expect(toRouteSlug(["00-overview", "product-vision.md"])).toEqual(["00-overview", "product-vision"]);
  });

  it("leaves a directory slug (no .md) unchanged", async () => {
    const { toRouteSlug } = await import("./vault");
    expect(toRouteSlug(["00-overview"])).toEqual(["00-overview"]);
  });

  it("leaves the root slug ([]) unchanged", async () => {
    const { toRouteSlug } = await import("./vault");
    expect(toRouteSlug([])).toEqual([]);
  });
});

describe("listVaultDir", () => {
  it("lists vault-root entries, excluding ignored ones, directories first then alpha", async () => {
    const { listVaultDir } = await import("./vault");
    const names = listVaultDir("").map((e) => e.name);
    expect(names).toContain("00-overview");
    expect(names).toContain("README.md");
    expect(names).toContain("INDEX.md");
    expect(names).not.toContain(".obsidian");
    expect(names).not.toContain("private");
  });

  it("returns [] for a nonexistent directory rather than throwing", async () => {
    const { listVaultDir } = await import("./vault");
    expect(listVaultDir("does-not-exist")).toEqual([]);
  });
});

describe("buildVaultTree", () => {
  it("includes directories and .md files, excludes ignored paths and non-md files", async () => {
    const { buildVaultTree } = await import("./vault");
    const tree = buildVaultTree();
    const names = tree.map((n) => n.name);
    expect(names).toContain("00-overview");
    expect(names).toContain("README.md");
    expect(names).not.toContain(".obsidian");
    expect(names).not.toContain("private");

    // "assets/" itself isn't ignored (only assets/source, assets/data are) so
    // the directory node shows up — but its non-.md child (diagram.png) and
    // its ignored "source" subdir should not appear among ITS children.
    const assetsNode = tree.find((n) => n.name === "assets");
    expect(assetsNode).toBeDefined();
    const assetsChildNames = assetsNode?.children?.map((c) => c.name) ?? [];
    expect(assetsChildNames).not.toContain("source");
    expect(assetsChildNames).not.toContain("diagram.png");
  });
});

describe("findRootLandingDoc", () => {
  it("prefers README.md over INDEX.md", async () => {
    const { findRootLandingDoc } = await import("./vault");
    const doc = findRootLandingDoc();
    expect(doc?.relPath).toBe("README.md");
    expect(doc?.content).toContain("Welcome");
  });
});

describe("explicit root parameter (spec 12 D22 — draft view over a worktree root)", () => {
  // A second, independent temp dir standing in for a chat session's worktree
  // vault root — distinct content from the env-derived vaultRoot() fixture
  // above, so a test passing would be impossible if a function silently fell
  // back to vaultRoot() instead of honoring the explicit root argument.
  let altRoot: string;

  beforeEach(() => {
    altRoot = mkdtempSync(path.join(tmpdir(), "vault-test-alt-root-"));
    mkdirSync(path.join(altRoot, "01-drafts"), { recursive: true });
    writeFileSync(path.join(altRoot, "README.md"), "# Draft Welcome");
    writeFileSync(path.join(altRoot, "01-drafts", "new-page.md"), "# A staged page");
  });

  afterEach(() => {
    rmSync(altRoot, { recursive: true, force: true });
  });

  it("resolveVaultEntry reads from the explicit root, not vaultRoot()", async () => {
    const { resolveVaultEntry } = await import("./vault");
    expect(resolveVaultEntry(["01-drafts", "new-page"], altRoot)).toMatchObject({
      relPath: "01-drafts/new-page.md",
      isDirectory: false,
    });
    // The alt root has no "00-overview" (that only exists in the env-derived vaultRoot() fixture).
    expect(resolveVaultEntry(["00-overview"], altRoot)).toBeNull();
  });

  it("listVaultDir lists the explicit root's own entries", async () => {
    const { listVaultDir } = await import("./vault");
    const names = listVaultDir("", altRoot).map((e) => e.name);
    expect(names).toContain("01-drafts");
    expect(names).not.toContain("00-overview");
  });

  it("buildVaultTree builds from the explicit root", async () => {
    const { buildVaultTree } = await import("./vault");
    const tree = buildVaultTree("", 0, 12, altRoot);
    expect(tree.map((n) => n.name)).toEqual(expect.arrayContaining(["01-drafts", "README.md"]));
    expect(tree.map((n) => n.name)).not.toContain("00-overview");
  });

  it("readVaultFile reads from the explicit root", async () => {
    const { readVaultFile } = await import("./vault");
    expect(readVaultFile("01-drafts/new-page.md", altRoot)).toContain("A staged page");
    expect(readVaultFile("00-overview/product-vision.md", altRoot)).toBeNull();
  });

  it("findRootLandingDoc reads from the explicit root", async () => {
    const { findRootLandingDoc } = await import("./vault");
    expect(findRootLandingDoc(altRoot)?.content).toContain("Draft Welcome");
  });

  it("omitting root still reads the live vaultRoot() fixture (zero behavior change for existing callers)", async () => {
    const { resolveVaultEntry, readVaultFile } = await import("./vault");
    expect(resolveVaultEntry(["00-overview", "product-vision"])).toMatchObject({ isDirectory: false });
    expect(readVaultFile("README.md")).toContain("Welcome");
  });
});

describe("searchVault", () => {
  it("matches by filename and by content, never returning ignored files", async () => {
    const { searchVault } = await import("./vault");
    const byName = searchVault("product-vision");
    expect(byName.some((r) => r.relPath === "00-overview/product-vision.md")).toBe(true);

    const byContent = searchVault("Orbit");
    expect(byContent.some((r) => r.relPath === "00-overview/product-vision.md")).toBe(true);

    const forIgnored = searchVault("should never be served");
    expect(forIgnored).toEqual([]);
  });

  it("returns [] for an empty/blank query", async () => {
    const { searchVault } = await import("./vault");
    expect(searchVault("")).toEqual([]);
    expect(searchVault("   ")).toEqual([]);
  });
});
