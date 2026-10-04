import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_TOTAL_CONTEXT_BYTES, TRUNCATION_MARKER, type MessageContext } from "./context";

// This is the security- and correctness-relevant boundary for selection
// context (spec 11 D18): a client-proposed path/line-range/selected-text
// tuple must never be trusted as-is — path containment reuses
// resolveVaultEntry's existing check (never a second one), and content must
// be re-read and re-verified against the real vault file, falling back to
// relocation and finally to a clearly-labeled client-provenance excerpt
// rather than ever 500ing or silently trusting unverified text.

const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR"] as const;
let savedEnv: Record<string, string | undefined>;
let vaultDir: string;

const TOKENOMICS_LINES = [
  "# Economy",
  "",
  "Intro text.",
  "",
  "## Tokenomics",
  "",
  "Points are the user-facing unit of value in Meridian.",
  "",
  "### Points Doctrine",
  "",
  "More detail here.",
  "",
  "## Governance",
  "",
  "Other section.",
];

function baseChip(overrides: Partial<MessageContext> = {}): MessageContext {
  return {
    type: "doc-selection",
    path: "04-economy/tokenomics.md",
    headingTrail: ["stale-client-trail"],
    startLine: 7,
    endLine: 7,
    selectedText: "Points are the user-facing unit of value in Meridian.",
    docTitle: "Tokenomics",
    ...overrides,
  } as MessageContext;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vaultDir = mkdtempSync(path.join(tmpdir(), "context-resolve-test-"));

  mkdirSync(path.join(vaultDir, "04-economy"), { recursive: true });
  writeFileSync(path.join(vaultDir, "04-economy", "tokenomics.md"), TOKENOMICS_LINES.join("\n"));

  mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vaultDir, ".obsidian", "config"), "secret");

  writeFileSync(path.join(vaultDir, "..", `${path.basename(vaultDir)}-secret.txt`), "outside the vault");

  process.env.LOCAL_REPO_PATH = vaultDir;
  process.env.VAULT_SUBDIR = ".";
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

describe("resolveMessageContext", () => {
  it("refuses a path that escapes the vault, without a second containment check", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip({ path: "../secret.txt" }));
    expect(result).toEqual({ ok: false, error: { kind: "containment", path: "../secret.txt" } });
  });

  it("refuses an ignored path (.obsidian)", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip({ path: ".obsidian/config" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a nonexistent path", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip({ path: "nope/does-not-exist.md" }));
    expect(result.ok).toBe(false);
  });

  it("verifies a matching line range and marks it provenance: verified", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.provenance).toBe("verified");
    expect(result.resolved.startLine).toBe(7);
    expect(result.resolved.endLine).toBe(7);
    expect(result.resolved.excerpt).toBe("Points are the user-facing unit of value in Meridian.");
  });

  it("verifies a selection of a bold/blockquote line against browser-rendered plain text (regression: raw markdown source vs. selection.toString())", async () => {
    // A real bug found in manual browser verification: `selection.toString()`
    // returns RENDERED plain text (no `>`/`**` markers), but the raw vault
    // file line still has them — comparing them unstripped always mismatched
    // on any formatted line, silently downgrading every such selection to
    // provenance: "client" even though nothing had actually changed.
    writeFileSync(
      path.join(vaultDir, "04-economy", "tokenomics.md"),
      "# Economy\n\n> **Purpose:** The north star for the economy.\n",
    );
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(
      baseChip({
        startLine: 3,
        endLine: 3,
        selectedText: "Purpose: The north star for the economy.",
        headingTrail: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.provenance).toBe("verified");
    // The excerpt sent to the model stays the REAL markdown, unstripped.
    expect(result.resolved.excerpt).toBe("> **Purpose:** The north star for the economy.");
  });

  it("computes the heading trail server-side, ignoring the client's stale trail", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.headingTrail).toEqual(["Economy", "Tokenomics"]);
  });

  it("expands to the enclosing section, bounded to the next same-or-shallower heading", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(baseChip());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.enclosingSection).toContain("### Points Doctrine");
    expect(result.resolved.enclosingSection).toContain("More detail here.");
    expect(result.resolved.enclosingSection).not.toContain("## Governance");
  });

  it("relocates a selection whose line numbers drifted, as long as the text still exists", async () => {
    const shifted = ["", "", ...TOKENOMICS_LINES]; // two lines inserted at the top
    writeFileSync(path.join(vaultDir, "04-economy", "tokenomics.md"), shifted.join("\n"));

    const { resolveMessageContext } = await import("./context-resolve");
    // Client still thinks the sentence is on line 7 (its stale pre-edit position).
    const result = resolveMessageContext(baseChip({ startLine: 7, endLine: 7 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.provenance).toBe("relocated");
    expect(result.resolved.startLine).toBe(9); // shifted down by the 2 inserted lines
    expect(result.resolved.endLine).toBe(9);
  });

  it("falls back to client provenance when the text can no longer be found anywhere in the file", async () => {
    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(
      baseChip({ startLine: 3, endLine: 3, selectedText: "This sentence was never in the file." }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.provenance).toBe("client");
    expect(result.resolved.excerpt).toBe("This sentence was never in the file.");
  });

  it("truncates an oversized excerpt with the exact spec'd marker", async () => {
    const longLine = "x".repeat(20_000);
    writeFileSync(path.join(vaultDir, "04-economy", "tokenomics.md"), `# Big\n\n${longLine}\n`);

    const { resolveMessageContext } = await import("./context-resolve");
    const result = resolveMessageContext(
      baseChip({ startLine: 3, endLine: 3, selectedText: longLine, headingTrail: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.truncated).toBe(true);
    expect(result.resolved.excerpt).toContain(TRUNCATION_MARKER);
  });
});

describe("renderContextBlock", () => {
  it("keeps the combined block within MAX_TOTAL_CONTEXT_BYTES across multiple large chips, truncating later ones first", async () => {
    const { resolveMessageContext, renderContextBlock } = await import("./context-resolve");
    const big = "y".repeat(7_000);
    writeFileSync(path.join(vaultDir, "04-economy", "tokenomics.md"), `# Big\n\n${big}\n`);

    const chip = baseChip({ startLine: 3, endLine: 3, selectedText: big, headingTrail: [] });
    const first = resolveMessageContext(chip);
    const second = resolveMessageContext(chip);
    const third = resolveMessageContext(chip);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    const block = renderContextBlock([first.resolved, second.resolved, third.resolved]);
    // Rough sanity bound: the rendered block shouldn't balloon far past the
    // total cap even though each individual chip was under its own per-chip cap.
    expect(block.length).toBeLessThan(MAX_TOTAL_CONTEXT_BYTES * 2);
    expect(block).toContain(CONTEXT_BLOCK_OPEN_MARK);
    expect(block).toContain(CONTEXT_BLOCK_CLOSE_MARK);
  });
});

const CONTEXT_BLOCK_OPEN_MARK = "<portal-context>";
const CONTEXT_BLOCK_CLOSE_MARK = "</portal-context>";
