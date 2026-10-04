import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";

// `refreshRepo()` shells out to `git` and touches the filesystem — mock both
// so these tests exercise the branching logic (clone vs fetch+reset, the
// local-dev skip, the missing-token skip, and — the important one — that a
// failed subprocess is caught and logged, never thrown) without any real
// network access or a real `/data` mount.

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const existsSyncMock = vi.fn();
const readdirSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

const mkdirMock = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

const getProjectionMock = vi.fn();
vi.mock("@/lib/authority/cache", () => ({
  getProjection: (...args: unknown[]) => getProjectionMock(...args),
}));

const { repoRoot, vaultRoot, vaultRootFor, vaultExists, refreshRepo, ensureFullHistoryForWrite, remoteUrlWithToken, repoUrl } =
  await import("./repo");

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

/** Scripts one `spawn()` call to succeed with the given stdout, async. */
function succeed(stdout = "") {
  return (): FakeChild => {
    const child = fakeChild();
    queueMicrotask(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      child.emit("close", 0);
    });
    return child;
  };
}

/** Scripts one `spawn()` call to fail like a real git network error would
 *  (non-zero exit, message on stderr) — not a spawn-level 'error' event,
 *  which is what an actual `git clone` failure looks like. */
function fail(stderrText: string) {
  return (): FakeChild => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from(stderrText));
      child.emit("close", 1);
    });
    return child;
  };
}

const ENV_KEYS = [
  "LOCAL_REPO_PATH",
  "REPO_READ_TOKEN",
  "REPO_URL",
  "VAULT_SUBDIR",
  "REPO_CHECKOUT_DIR",
  "AUTHORITY_ENABLED",
  "MEMORY_CHECKOUT_DIR",
  "GIT_HOST",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  readdirSyncMock.mockReset();
  readFileSyncMock.mockReset();
  mkdirMock.mockClear();
  getProjectionMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("repoRoot", () => {
  it("resolves LOCAL_REPO_PATH when set and REPO_READ_TOKEN is unset (local dev)", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    expect(repoRoot()).toBe("/tmp/my-docs-checkout");
  });

  it("ignores LOCAL_REPO_PATH once REPO_READ_TOKEN is set (real deploy)", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    process.env.REPO_READ_TOKEN = "glpat-something";
    expect(repoRoot()).toBe("/data/repo");
  });

  it("falls back to the managed PVC checkout when neither env is set", () => {
    expect(repoRoot()).toBe("/data/repo");
  });

  it("honors REPO_CHECKOUT_DIR as an override for the managed checkout (e.g. local testing without a /data mount)", () => {
    process.env.REPO_CHECKOUT_DIR = "/tmp/portal-checkout-test";
    expect(repoRoot()).toBe("/tmp/portal-checkout-test");
  });

  it("resolves a relative REPO_CHECKOUT_DIR against cwd, like LOCAL_REPO_PATH does", () => {
    process.env.REPO_CHECKOUT_DIR = "relative-checkout-dir";
    expect(repoRoot()).toBe(path.resolve(process.cwd(), "relative-checkout-dir"));
  });

  it("REPO_CHECKOUT_DIR has no effect when LOCAL_REPO_PATH is set (local-dev mode wins)", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    process.env.REPO_CHECKOUT_DIR = "/tmp/should-be-ignored";
    expect(repoRoot()).toBe("/tmp/my-docs-checkout");
  });
});

describe("vaultRoot", () => {
  it("defaults to `docs` under repoRoot() when VAULT_SUBDIR is unset", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    expect(vaultRoot()).toBe("/tmp/my-docs-checkout/docs");
  });

  it("treats VAULT_SUBDIR='.' as 'repo root is the vault'", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/vault-checkout";
    process.env.VAULT_SUBDIR = ".";
    expect(vaultRoot()).toBe("/tmp/vault-checkout");
  });

  it("treats VAULT_SUBDIR='' as 'repo root is the vault'", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/vault-checkout";
    process.env.VAULT_SUBDIR = "";
    expect(vaultRoot()).toBe("/tmp/vault-checkout");
  });

  it("joins a custom VAULT_SUBDIR onto repoRoot()", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    process.env.VAULT_SUBDIR = "knowledge-base";
    expect(vaultRoot()).toBe("/tmp/my-docs-checkout/knowledge-base");
  });

  it("resolves against the managed PVC checkout when neither LOCAL_REPO_PATH nor VAULT_SUBDIR override it", () => {
    expect(vaultRoot()).toBe("/data/repo/docs");
  });
});

describe("vaultRootFor", () => {
  it("keeps the existing vault byte-path when authority is disabled", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    delete process.env.AUTHORITY_ENABLED;
    expect(vaultRootFor(["all-hands", "exec"])).toBe("/tmp/my-docs-checkout/docs");
    expect(getProjectionMock).not.toHaveBeenCalled();
  });

  it("returns the clearance projection when authority is enabled", () => {
    process.env.AUTHORITY_ENABLED = "1";
    process.env.MEMORY_CHECKOUT_DIR = "/tmp/private";
    readFileSyncMock
      .mockReturnValueOnce("groups:\n  exec: [alice@example.com]\n")
      .mockReturnValueOnce("roles:\n  admin: [admin@example.com]\ndefault: viewer\n");
    getProjectionMock.mockReturnValue("/tmp/projections/exec");
    expect(vaultRootFor(["all-hands", "exec"])).toBe("/tmp/projections/exec");
    expect(getProjectionMock).toHaveBeenCalledWith(
      ["all-hands", "exec"],
      { groupsHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    );
  });

  it("changes the projection access version when roles change", () => {
    process.env.AUTHORITY_ENABLED = "1";
    readFileSyncMock
      .mockReturnValueOnce("groups: {}\n")
      .mockReturnValueOnce("roles:\n  admin: [first@example.com]\ndefault: viewer\n")
      .mockReturnValueOnce("groups: {}\n")
      .mockReturnValueOnce("roles:\n  admin: [second@example.com]\ndefault: viewer\n");
    getProjectionMock.mockReturnValue("/tmp/projections/all-hands");

    vaultRootFor(["all-hands"]);
    vaultRootFor(["all-hands"]);

    const first = getProjectionMock.mock.calls[0][1].groupsHash;
    const second = getProjectionMock.mock.calls[1][1].groupsHash;
    expect(second).not.toBe(first);
  });
});

describe("vaultExists", () => {
  it("is true when the vault dir exists and holds at least one entry", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    readdirSyncMock.mockReturnValue(["overview.md", "strategy"]);
    expect(vaultExists()).toBe(true);
    expect(readdirSyncMock).toHaveBeenCalledWith("/tmp/my-docs-checkout/docs");
  });

  it("is false when the vault dir exists but is empty", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    readdirSyncMock.mockReturnValue([]);
    expect(vaultExists()).toBe(false);
  });

  it("is false when the vault dir does not exist (readdirSync throws)", () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(vaultExists()).toBe(false);
  });
});

describe("refreshRepo", () => {
  it("skips all git work when LOCAL_REPO_PATH is set (local dev)", async () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    await refreshRepo();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("skips git work and logs when REPO_URL is unset and there is no local checkout", async () => {
    delete process.env.REPO_URL;
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(refreshRepo()).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("REPO_URL"));
    errSpy.mockRestore();
  });

  it("skips git work and logs when REPO_READ_TOKEN is missing", async () => {
    process.env.REPO_URL = "https://git.example.com/acme/kb.git";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await refreshRepo();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("REPO_READ_TOKEN"));
    errSpy.mockRestore();
  });

  it("clones when no .git exists yet, using an oauth2-token remote URL", async () => {
    process.env.REPO_URL = "https://git.example.com/acme/kb.git";
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    existsSyncMock.mockReturnValue(false);
    spawnMock
      .mockImplementationOnce(succeed()) // clone
      .mockImplementationOnce(succeed("deadbeef123")); // rev-parse HEAD

    await refreshRepo();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [cloneCmd, cloneArgs] = spawnMock.mock.calls[0];
    expect(cloneCmd).toBe("git");
    expect(cloneArgs).toEqual(
      expect.arrayContaining(["clone", "--depth", "1", "--branch", "main"]),
    );
    const remoteArg = cloneArgs[cloneArgs.length - 2];
    expect(remoteArg).toContain("oauth2:secret-token-abc@");
    expect(remoteArg).toContain("git.example.com/acme/kb.git");
    expect(cloneArgs[cloneArgs.length - 1]).toBe("/data/repo");
  });

  it("clones into REPO_CHECKOUT_DIR when overridden, instead of the /data/repo default", async () => {
    process.env.REPO_URL = "https://git.example.com/acme/kb.git";
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    process.env.REPO_CHECKOUT_DIR = "/tmp/portal-checkout-test";
    existsSyncMock.mockReturnValue(false);
    spawnMock
      .mockImplementationOnce(succeed()) // clone
      .mockImplementationOnce(succeed("deadbeef123")); // rev-parse HEAD

    await refreshRepo();

    const [, cloneArgs] = spawnMock.mock.calls[0];
    expect(cloneArgs[cloneArgs.length - 1]).toBe("/tmp/portal-checkout-test");
  });

  it("fetches + hard-resets when .git already exists", async () => {
    process.env.REPO_URL = "https://git.example.com/acme/kb.git";
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    existsSyncMock.mockReturnValue(true);
    spawnMock
      .mockImplementationOnce(succeed()) // remote set-url
      .mockImplementationOnce(succeed()) // fetch
      .mockImplementationOnce(succeed()) // reset --hard
      .mockImplementationOnce(succeed("cafef00d")); // rev-parse HEAD

    await refreshRepo();

    expect(spawnMock).toHaveBeenCalledTimes(4);
    const subcommands = spawnMock.mock.calls.map(([, args]) => args[2]);
    expect(subcommands).toEqual(["remote", "fetch", "reset", "rev-parse"]);
  });

  it("clones the repo named by the REPO_URL env override instead of another", async () => {
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    process.env.REPO_URL = "https://git.example.com/acme/other-kb.git";
    existsSyncMock.mockReturnValue(false);
    spawnMock
      .mockImplementationOnce(succeed()) // clone
      .mockImplementationOnce(succeed("deadbeef123")); // rev-parse HEAD

    await refreshRepo();

    const [, cloneArgs] = spawnMock.mock.calls[0];
    const remoteArg = cloneArgs[cloneArgs.length - 2];
    expect(remoteArg).toContain("oauth2:secret-token-abc@");
    expect(remoteArg).toContain("git.example.com/acme/other-kb.git");
  });

  it("never throws on a malformed REPO_URL: logs and skips the git work entirely", async () => {
    process.env.REPO_READ_TOKEN = "secret-token-abc";
    process.env.REPO_URL = "not a url";
    existsSyncMock.mockReturnValue(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(refreshRepo()).resolves.toBeUndefined();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("never throws on a failed clone (network error) and redacts the token from logs", async () => {
    process.env.REPO_URL = "https://git.example.com/acme/kb.git";
    process.env.REPO_READ_TOKEN = "super-secret-token";
    existsSyncMock.mockReturnValue(false);
    spawnMock.mockImplementationOnce(
      fail(
        "fatal: unable to access 'https://oauth2:super-secret-token@git.example.com/acme/kb.git/': Could not resolve host: gitlab.com",
      ),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(refreshRepo()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    const loggedText = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(loggedText).not.toContain("super-secret-token");
    expect(loggedText).toContain("***");
    errSpy.mockRestore();
  });
});

describe("remoteUrlWithToken", () => {
  // The single seam every remote-touching caller goes through: refreshRepo's
  // clone/fetch, repo-write's push, and repo-memory's origin all call this,
  // so these two cases cover the REPO_URL override for all of them.
  it("repoUrl returns an empty string when REPO_URL is unset", () => {
    delete process.env.REPO_URL;
    expect(repoUrl()).toBe("");
  });

  it("embeds the token into the REPO_URL env override when set", () => {
    process.env.REPO_URL = "https://git.example.com/acme/other-kb.git";
    expect(remoteUrlWithToken("tok-123")).toBe(
      "https://oauth2:tok-123@git.example.com/acme/other-kb.git",
    );
  });

  it("uses x-access-token as the username for a GitHub repository", () => {
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    expect(remoteUrlWithToken("tok-123")).toBe("https://x-access-token:tok-123@github.com/acme/kb.git");
  });

  it("uses x-access-token for a GitHub Enterprise host selected by GIT_HOST", () => {
    process.env.REPO_URL = "https://ghe.example.com/acme/kb.git";
    process.env.GIT_HOST = "github";
    expect(remoteUrlWithToken("tok-123")).toBe("https://x-access-token:tok-123@ghe.example.com/acme/kb.git");
  });
});

describe("ensureFullHistoryForWrite", () => {
  it("skips all git work when LOCAL_REPO_PATH is set (local dev)", async () => {
    process.env.LOCAL_REPO_PATH = "/tmp/my-docs-checkout";
    await ensureFullHistoryForWrite();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("skips when there is no checkout at all yet (no .git)", async () => {
    existsSyncMock.mockReturnValue(false);
    await ensureFullHistoryForWrite();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("unshallows when the checkout is shallow", async () => {
    existsSyncMock.mockReturnValue(true);
    spawnMock
      .mockImplementationOnce(succeed("true")) // rev-parse --is-shallow-repository
      .mockImplementationOnce(succeed()); // fetch --unshallow

    await ensureFullHistoryForWrite();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [, isShallowArgs] = spawnMock.mock.calls[0];
    expect(isShallowArgs).toEqual(expect.arrayContaining(["rev-parse", "--is-shallow-repository"]));
    const [, unshallowArgs] = spawnMock.mock.calls[1];
    expect(unshallowArgs).toEqual(expect.arrayContaining(["fetch", "--unshallow", "origin", "main"]));
  });

  it("does nothing further when the checkout already has full history", async () => {
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockImplementationOnce(succeed("false")); // rev-parse --is-shallow-repository

    await ensureFullHistoryForWrite();

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("never throws on failure and redacts the read token from logs", async () => {
    process.env.REPO_READ_TOKEN = "super-secret-token";
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockImplementationOnce(fail("fatal: could not read Username for 'https://oauth2:super-secret-token@gitlab.com'"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensureFullHistoryForWrite()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    const loggedText = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(loggedText).not.toContain("super-secret-token");
    errSpy.mockRestore();
  });
});
