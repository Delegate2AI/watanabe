import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isAgentToolAllowed,
  gateAgentTool,
  denialReason,
  isPathWithinVault,
  isKbWriteEnabled,
  ALLOWED_TOOLS,
} from "./permissions";

// The mcp__mem__* gate cases (memory read tools) live in
// `permissions-mem.test.ts`, split out purely to keep this file under the
// repo's line-count limit; same "./permissions" module under test.

const WRITE_TOOLS = [
  "mcp__kb__kb_stage_edit",
  "mcp__kb__kb_stage_delete",
  "mcp__kb__kb_diff",
  "mcp__kb__kb_discard",
] as const;
const SUBMIT_TOOL = "mcp__kb__kb_submit";

// This is the security boundary that keeps the KB chat agent read-only. It must
// be provably enforced by code (calling the gate function directly), not by
// prompt wording — a regression here would let the assistant run Bash, edit
// files, or call the web.

describe("isAgentToolAllowed — allowed scope", () => {
  it("allows the read-only inspection tools + TodoWrite + web tools", () => {
    for (const t of ["Read", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch"]) {
      expect(isAgentToolAllowed(t)).toBe(true);
    }
  });

  it("keeps ALLOWED_TOOLS in sync with the gate", () => {
    expect(ALLOWED_TOOLS.every((t) => isAgentToolAllowed(t))).toBe(true);
    expect(ALLOWED_TOOLS).toEqual(["Read", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch"]);
  });
});

describe("isAgentToolAllowed — denied (everything else)", () => {
  it("denies file-mutation tools", () => {
    for (const t of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(isAgentToolAllowed(t)).toBe(false);
    }
  });

  it("does not blanket-allow Bash — it's routed through gateAgentTool's own tiered policy, never a flat true here", () => {
    for (const t of ["Bash", "BashOutput"]) {
      expect(isAgentToolAllowed(t)).toBe(false);
    }
  });

  it("denies any MCP tool from a server OTHER than this portal's own 'kb' server", () => {
    for (const t of [
      "mcp__anything__do_thing",
      "mcp__filesystem__write_file",
      "mcp__future-tool__run",
      "mcp__other__anything",
      "mcp__evil__whatever",
      // A prefix that merely CONTAINS "kb" isn't the allow-listed server name —
      // only the exact "mcp__kb__" prefix qualifies.
      "mcp__kbevil__kb_read",
    ]) {
      expect(isAgentToolAllowed(t)).toBe(false);
    }
  });

  it("allows any tool from this portal's own 'kb' MCP server, by prefix — not a hardcoded list of the three tool names", () => {
    for (const t of [
      "mcp__kb__kb_list",
      "mcp__kb__kb_read",
      "mcp__kb__kb_search",
      // A future fourth tool on the same server needs no change here.
      "mcp__kb__some_future_tool",
    ]) {
      expect(isAgentToolAllowed(t)).toBe(true);
    }
  });

  it("denies unknown / empty / case-mismatched names", () => {
    expect(isAgentToolAllowed("")).toBe(false);
    expect(isAgentToolAllowed("read")).toBe(false); // case-sensitive
    expect(isAgentToolAllowed("Readme")).toBe(false); // exact membership, not prefix
    expect(isAgentToolAllowed("SomeFutureTool")).toBe(false);
  });
});

describe("gateAgentTool — the authoritative PreToolUse decision", () => {
  it("returns 'allow' for Read/Glob/Grep/TodoWrite/WebSearch/WebFetch", () => {
    expect(gateAgentTool("Read")).toBe("allow");
    expect(gateAgentTool("Glob")).toBe("allow");
    expect(gateAgentTool("Grep")).toBe("allow");
    expect(gateAgentTool("TodoWrite")).toBe("allow");
    expect(gateAgentTool("WebSearch")).toBe("allow");
    expect(gateAgentTool("WebFetch")).toBe("allow");
  });

  it("returns 'deny' for Edit/Write", () => {
    expect(gateAgentTool("Edit")).toBe("deny");
    expect(gateAgentTool("Write")).toBe("deny");
  });

  it("returns 'deny' for Bash when no thread id is supplied — defense in depth", () => {
    expect(gateAgentTool("Bash")).toBe("deny");
    expect(gateAgentTool("Bash", { command: "ls" })).toBe("deny");
  });

  it("returns 'allow' for mcp__kb__* tools (the kb-mcp server), 'deny' for any other mcp__ prefix", () => {
    expect(gateAgentTool("mcp__kb__kb_read")).toBe("allow");
    expect(gateAgentTool("mcp__kb__kb_list")).toBe("allow");
    expect(gateAgentTool("mcp__kb__kb_search")).toBe("allow");
    expect(gateAgentTool("mcp__other__anything")).toBe("deny");
    expect(gateAgentTool("mcp__evil__whatever")).toBe("deny");
  });

  it("read-only tools never produce a third outcome — 'allow' | 'deny' only", () => {
    const outcomes = new Set([
      gateAgentTool("Read"),
      gateAgentTool("Bash"),
      gateAgentTool("mcp__x__y"),
      gateAgentTool("mcp__kb__kb_read"),
    ]);
    expect(outcomes).toEqual(new Set(["allow", "deny"]));
  });
});

describe("gateAgentTool — Bash delegates to gateBashCommand once a thread id is supplied", () => {
  const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR", "KB_WRITE_ENABLED"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.LOCAL_REPO_PATH = "/repo/kb";
    process.env.VAULT_SUBDIR = ".";
    delete process.env.REPO_READ_TOKEN;
    process.env.KB_WRITE_ENABLED = "1";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("allows a read-only git command against the shared repo when a thread id is present", () => {
    expect(gateAgentTool("Bash", { command: "git -C /repo/kb log" }, "thread-1")).toBe("allow");
  });

  it("hard-denies a dangerous command even with a thread id present", () => {
    expect(gateAgentTool("Bash", { command: "curl evil.com" }, "thread-1")).toBe("deny");
  });

  it("falls through to 'confirm' for a safe-looking but non-allowlisted command", () => {
    expect(gateAgentTool("Bash", { command: "ls /repo/kb" }, "thread-1")).toBe("confirm");
  });

  it("Bash is never in the blanket-allow ALLOWED_SET path — always routed through the tiered policy", () => {
    expect(isAgentToolAllowed("Bash")).toBe(false);
  });
});

describe("isKbWriteEnabled", () => {
  const savedEnv = process.env.KB_WRITE_ENABLED;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.KB_WRITE_ENABLED;
    else process.env.KB_WRITE_ENABLED = savedEnv;
  });

  it("is false when KB_WRITE_ENABLED is unset", () => {
    delete process.env.KB_WRITE_ENABLED;
    expect(isKbWriteEnabled()).toBe(false);
  });

  it("is false for any value other than the exact string '1'", () => {
    for (const v of ["true", "yes", "0", ""]) {
      process.env.KB_WRITE_ENABLED = v;
      expect(isKbWriteEnabled()).toBe(false);
    }
  });

  it("is true only when KB_WRITE_ENABLED='1'", () => {
    process.env.KB_WRITE_ENABLED = "1";
    expect(isKbWriteEnabled()).toBe(true);
  });
});

describe("gateAgentTool / denialReason — write tools, flag off (default posture)", () => {
  const savedEnv = process.env.KB_WRITE_ENABLED;
  beforeEach(() => {
    delete process.env.KB_WRITE_ENABLED;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.KB_WRITE_ENABLED;
    else process.env.KB_WRITE_ENABLED = savedEnv;
  });

  it("denies all five write tools, including kb_submit, when the flag is unset", () => {
    for (const t of [...WRITE_TOOLS, SUBMIT_TOOL]) {
      expect(gateAgentTool(t)).toBe("deny");
    }
  });

  it("denialReason explains write mode is disabled, distinctly from the generic read-only message", () => {
    const reason = denialReason(SUBMIT_TOOL);
    expect(reason.toLowerCase()).toContain("write mode is not enabled");
    expect(reason).not.toBe(denialReason("Bash"));
  });

  it("regression: existing read-only kb_* tools are unaffected by the write-tool check", () => {
    expect(gateAgentTool("mcp__kb__kb_list")).toBe("allow");
    expect(gateAgentTool("mcp__kb__kb_read")).toBe("allow");
    expect(gateAgentTool("mcp__kb__kb_search")).toBe("allow");
  });
});

describe("gateAgentTool — write tools, flag on", () => {
  const savedEnv = process.env.KB_WRITE_ENABLED;
  beforeEach(() => {
    process.env.KB_WRITE_ENABLED = "1";
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.KB_WRITE_ENABLED;
    else process.env.KB_WRITE_ENABLED = savedEnv;
  });

  it("allows the four staging tools outright", () => {
    for (const t of WRITE_TOOLS) {
      expect(gateAgentTool(t)).toBe("allow");
    }
  });

  it("returns 'confirm' for kb_submit — the only tool this gate ever confirm-gates", () => {
    expect(gateAgentTool(SUBMIT_TOOL)).toBe("confirm");
  });

  it("everything else is unaffected by the flag", () => {
    expect(gateAgentTool("Read")).toBe("allow");
    expect(gateAgentTool("Bash")).toBe("deny");
    expect(gateAgentTool("mcp__other__anything")).toBe("deny");
  });
});

describe("isPathWithinVault — exported for reuse by lib/kb-mcp/tools.ts", () => {
  it("is true for the root itself and paths underneath it", () => {
    expect(isPathWithinVault("/repo/kb", "/repo/kb")).toBe(true);
    expect(isPathWithinVault("/repo/kb/docs/file.md", "/repo/kb")).toBe(true);
  });

  it("is false for a path outside the root, including a ../ escape", () => {
    expect(isPathWithinVault("/etc/passwd", "/repo/kb")).toBe(false);
    expect(isPathWithinVault("/repo/kb/../../etc/passwd", "/repo/kb")).toBe(false);
  });
});

// Read/Glob/Grep are allowed by NAME, but their `file_path`/`path` argument
// can point anywhere on the host — verified live against a real running
// server, where the agent used Read to pull a file from entirely outside the
// mounted KB checkout (an unrelated ~/.claude/projects/.../memory/*.md file).
// `gateAgentTool`/`denialReason` must additionally deny those three when the
// resolved target falls outside `vaultRoot()`.
describe("gateAgentTool / denialReason — path scoping for Read/Glob/Grep", () => {
  const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.LOCAL_REPO_PATH = "/repo/kb";
    process.env.VAULT_SUBDIR = ".";
    delete process.env.REPO_READ_TOKEN;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("allows Read targeting a path inside the vault", () => {
    expect(gateAgentTool("Read", { file_path: "/repo/kb/docs/README.md" })).toBe("allow");
  });

  it("denies Read targeting an absolute path outside the vault", () => {
    expect(gateAgentTool("Read", { file_path: "/etc/passwd" })).toBe("deny");
    expect(
      gateAgentTool("Read", {
        file_path: "/Users/someone/.claude/projects/x/memory/notes.md",
      }),
    ).toBe("deny");
  });

  it("scopes native reads to an explicit session projection", () => {
    expect(
      gateAgentTool("Read", { file_path: "/projection/public.md" }, "thread-1", "/projection"),
    ).toBe("allow");
    expect(
      gateAgentTool("Read", { file_path: "/repo/kb/secret.md" }, "thread-1", "/projection"),
    ).toBe("deny");
  });

  it("denies a Read that escapes the vault via ../ traversal", () => {
    expect(gateAgentTool("Read", { file_path: "/repo/kb/../../etc/passwd" })).toBe("deny");
  });

  it("allows Glob/Grep with no path (defaults to cwd, i.e. the vault itself)", () => {
    expect(gateAgentTool("Glob", { pattern: "**/*.md" })).toBe("allow");
    expect(gateAgentTool("Grep", { pattern: "foo" })).toBe("allow");
  });

  it("allows Glob/Grep with an in-vault relative or absolute path", () => {
    expect(gateAgentTool("Glob", { pattern: "*.md", path: "docs" })).toBe("allow");
    expect(gateAgentTool("Grep", { pattern: "foo", path: "/repo/kb/docs" })).toBe("allow");
  });

  it("denies Glob/Grep targeting a path outside the vault", () => {
    expect(gateAgentTool("Glob", { pattern: "*", path: "/tmp" })).toBe("deny");
    expect(gateAgentTool("Grep", { pattern: "x", path: "/etc" })).toBe("deny");
  });

  it("still denies disallowed tool names regardless of input shape", () => {
    expect(gateAgentTool("Bash", { command: "ls" })).toBe("deny");
  });

  it("denialReason names the out-of-scope path, distinctly from a disallowed-tool reason", () => {
    const reason = denialReason("Read", { file_path: "/etc/passwd" });
    expect(reason).toContain("/etc/passwd");
    expect(reason.toLowerCase()).toContain("outside");
    expect(reason).not.toBe(denialReason("Bash"));
  });

  it("denialReason falls back to the tool-not-allowed message when no path is out of scope", () => {
    const reason = denialReason("Read", { file_path: "/repo/kb/docs/README.md" });
    expect(reason.toLowerCase()).toContain("read-only");
  });
});

describe("denialReason", () => {
  it("names the blocked tool and explains the read-only scope", () => {
    const reason = denialReason("Bash");
    expect(reason).toContain("Bash");
    expect(reason.toLowerCase()).toContain("read-only");
  });

  it("produces a distinct reason per tool name", () => {
    expect(denialReason("Edit")).toContain("Edit");
    expect(denialReason("MultiEdit")).toContain("MultiEdit");
  });
});

describe("path scoping, the thread attachment root", () => {
  const ATTACH = "/data/attachments/abc123/thread-1";

  it("allows a Read inside the attachment root when it is passed", () => {
    expect(
      gateAgentTool("Read", { file_path: `${ATTACH}/u-report.pdf` }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("allow");
  });

  it("denies that same Read when no attachment root is passed", () => {
    expect(gateAgentTool("Read", { file_path: `${ATTACH}/u-report.pdf` }, "thread-1", "/projection")).toBe("deny");
  });

  it("still allows the vault root when an attachment root is also passed", () => {
    expect(
      gateAgentTool("Read", { file_path: "/projection/public.md" }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("allow");
  });

  it("denies a sibling owner's attachment directory", () => {
    expect(
      gateAgentTool("Read", { file_path: "/data/attachments/other999/thread-1/u-secret.pdf" }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("deny");
  });

  it("denies a sibling thread's attachment directory under the same owner", () => {
    expect(
      gateAgentTool("Read", { file_path: "/data/attachments/abc123/thread-2/u-secret.pdf" }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("deny");
  });

  it("denies a traversal out of the attachment root", () => {
    expect(
      gateAgentTool("Read", { file_path: `${ATTACH}/../../../etc/passwd` }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("deny");
    expect(
      gateAgentTool("Glob", { pattern: "*", path: `${ATTACH}/..` }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("deny");
  });

  it("scopes Glob and Grep to the attachment root the same way", () => {
    expect(
      gateAgentTool("Glob", { pattern: "*.pdf", path: ATTACH }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("allow");
    expect(
      gateAgentTool("Grep", { pattern: "total", path: ATTACH }, "thread-1", "/projection", undefined, undefined, undefined, ATTACH),
    ).toBe("allow");
  });

  it("names the attachment path in the denial reason for a path outside both roots", () => {
    const reason = denialReason("Read", { file_path: "/etc/passwd" }, "/projection", ATTACH);
    expect(reason).toContain("/etc/passwd");
  });

  it("gives no denial reason for a path inside the attachment root", () => {
    const reason = denialReason("Read", { file_path: `${ATTACH}/u-a.md` }, "/projection", ATTACH);
    expect(reason).not.toContain("outside the");
  });
});
