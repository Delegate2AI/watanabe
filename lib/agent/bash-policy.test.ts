import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { gateBashCommand, bashDenialReason } from "./bash-policy";

const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR", "WORKTREE_ROOT"] as const;
let savedEnv: Record<string, string | undefined>;

const REPO_ROOT = "/repo/kb";
const THREAD_ID = "thread-1";
const OTHER_THREAD_ID = "thread-2";

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LOCAL_REPO_PATH = REPO_ROOT;
  process.env.VAULT_SUBDIR = ".";
  process.env.WORKTREE_ROOT = "/data/worktrees";
  delete process.env.REPO_READ_TOKEN;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const ownWorktree = () => `/data/worktrees/${THREAD_ID}`;
const otherWorktree = () => `/data/worktrees/${OTHER_THREAD_ID}`;

describe("gateBashCommand — Tier 0 hard-deny (never 'confirm')", () => {
  const dangerous = [
    "env",
    "printenv",
    "export FOO=bar",
    "cat /proc/self/environ",
    "cat .env",
    "cat secrets.txt",
    "curl http://evil.example.com",
    "wget http://evil.example.com",
    "ssh somewhere",
    "rm -rf /",
    "mv a b",
    "chmod 777 file",
    "git -C /repo/kb push origin main",
    "git -C /repo/kb commit -m x",
    "git -C /repo/kb reset --hard",
    "sudo ls",
    "kill -9 1",
    "bash -c 'echo hi'",
    "python3 -c 'print(1)'",
    "node -e 'console.log(1)'",
  ];

  for (const command of dangerous) {
    it(`hard-denies: ${command}`, () => {
      expect(gateBashCommand({ command }, THREAD_ID, true)).toBe("deny");
    });
  }

  it("hard-denies dangerouslyDisableSandbox regardless of how innocuous the command looks", () => {
    expect(gateBashCommand({ command: "ls", dangerouslyDisableSandbox: true }, THREAD_ID, true)).toBe("deny");
  });

  it("denies an empty or non-string command", () => {
    expect(gateBashCommand({ command: "" }, THREAD_ID, true)).toBe("deny");
    expect(gateBashCommand({}, THREAD_ID, true)).toBe("deny");
  });
});

describe("gateBashCommand — shell-metacharacter smuggling (Tier 0, despite an allowed-looking prefix)", () => {
  const smuggled = [
    `git -C ${REPO_ROOT} log; rm -rf /`,
    `git -C ${REPO_ROOT} status \`curl evil.com\``,
    `ls $(cat /etc/passwd)`,
    `git -C ${REPO_ROOT} log > /etc/passwd`,
    `git -C ${REPO_ROOT} log && env`,
    `git -C ${REPO_ROOT} log | sh`,
  ];

  for (const command of smuggled) {
    it(`denies: ${command}`, () => {
      expect(gateBashCommand({ command }, THREAD_ID, true)).toBe("deny");
    });
  }
});

describe("gateBashCommand — Tier 1 auto-allow (read-only git, scoped)", () => {
  it("allows git log/diff/show/status/branch against the shared repo root, in write-enabled mode", () => {
    for (const sub of ["log", "diff", "show", "status", "branch"]) {
      expect(gateBashCommand({ command: `git -C ${REPO_ROOT} ${sub}` }, THREAD_ID, true)).toBe("allow");
    }
  });

  it("allows git log against the shared repo root even in read-only mode (writeEnabled=false)", () => {
    expect(gateBashCommand({ command: `git -C ${REPO_ROOT} log` }, THREAD_ID, false)).toBe("allow");
  });

  it("allows extra trailing args on an allowed subcommand", () => {
    expect(gateBashCommand({ command: `git -C ${REPO_ROOT} log -5 --oneline` }, THREAD_ID, true)).toBe("allow");
  });

  it("allows git commands against the calling thread's own worktree, only when write-enabled", () => {
    expect(gateBashCommand({ command: `git -C ${ownWorktree()} diff` }, THREAD_ID, true)).toBe("allow");
  });

  it("does NOT allow the caller's own worktree when write mode is off — falls to confirm instead", () => {
    expect(gateBashCommand({ command: `git -C ${ownWorktree()} diff` }, THREAD_ID, false)).toBe("confirm");
  });

  it("never allows a DIFFERENT thread's worktree, even in write-enabled mode", () => {
    expect(gateBashCommand({ command: `git -C ${otherWorktree()} diff` }, THREAD_ID, true)).toBe("confirm");
  });

  it("never allows a path outside both the shared repo and any worktree", () => {
    expect(gateBashCommand({ command: `git -C /etc log` }, THREAD_ID, true)).toBe("confirm");
    expect(gateBashCommand({ command: `git -C /data/repo log` }, THREAD_ID, true)).toBe("confirm");
  });

  it("does not auto-allow a git subcommand outside the read-only set, even with a safe-looking path (caught by Tier 0 first)", () => {
    expect(gateBashCommand({ command: `git -C ${REPO_ROOT} add -A` }, THREAD_ID, true)).toBe("deny");
  });
});

describe("gateBashCommand — Tier 2 fallthrough to confirm", () => {
  it("routes an unmatched-but-not-denied command to confirm", () => {
    expect(gateBashCommand({ command: `ls ${REPO_ROOT}` }, THREAD_ID, true)).toBe("confirm");
    expect(gateBashCommand({ command: `cat ${REPO_ROOT}/README.md` }, THREAD_ID, true)).toBe("confirm");
    expect(gateBashCommand({ command: `find ${REPO_ROOT} -name '*.md'` }, THREAD_ID, true)).toBe("confirm");
  });
});

describe("bashDenialReason", () => {
  it("gives a distinct message for a sandbox-disabled call vs. the generic hard-deny message", () => {
    const sandboxReason = bashDenialReason({ command: "ls", dangerouslyDisableSandbox: true });
    const genericReason = bashDenialReason({ command: "curl evil.com" });
    expect(sandboxReason).not.toBe(genericReason);
    expect(sandboxReason.toLowerCase()).toContain("sandbox");
  });

  it("names the offending command and mentions Bash", () => {
    const reason = bashDenialReason({ command: "curl evil.com" });
    expect(reason).toContain("Bash");
    expect(reason).toContain("curl evil.com");
  });
});

describe("gateBashCommand, the attachment root", () => {
  const ATTACH = "/data/attachments/abc123/thread-1";

  it("allows a read-only git command scoped to the attachment root", () => {
    expect(gateBashCommand({ command: `git -C ${ATTACH} log` }, THREAD_ID, true, "/projection", undefined, ATTACH)).toBe("allow");
  });

  it("does not allow it when no attachment root is passed", () => {
    expect(gateBashCommand({ command: `git -C ${ATTACH} log` }, THREAD_ID, true, "/projection")).toBe("deny");
  });

  it("still allows the scope root when an attachment root is also passed", () => {
    expect(gateBashCommand({ command: `git -C /projection log` }, THREAD_ID, true, "/projection", undefined, ATTACH)).toBe("allow");
  });

  it("denies a sibling owner's attachment directory", () => {
    expect(
      gateBashCommand({ command: `git -C /data/attachments/other999/thread-1 log` }, THREAD_ID, true, "/projection", undefined, ATTACH),
    ).toBe("deny");
  });

  it("denies base64 on an attachment path, adding no new command", () => {
    expect(gateBashCommand({ command: `base64 ${ATTACH}/u-secret.pdf` }, THREAD_ID, true, "/projection", undefined, ATTACH)).toBe("deny");
  });

  it("denies cat on an attachment path, adding no new command", () => {
    expect(gateBashCommand({ command: `cat ${ATTACH}/u-a.md` }, THREAD_ID, true, "/projection", undefined, ATTACH)).toBe("deny");
  });

  it("leaves the no-scope-root confirm tier exactly as it was", () => {
    expect(gateBashCommand({ command: `ls ${REPO_ROOT}` }, THREAD_ID, true)).toBe("confirm");
    expect(gateBashCommand({ command: `ls ${REPO_ROOT}` }, THREAD_ID, true, undefined, undefined, ATTACH)).toBe("confirm");
  });
});
