import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The install-git route against a real local fixture repository cloned over
 * `file://`, with the install pipeline NOT mocked. Every other route test
 * substitutes `installFromGit`, so nothing else proves the route actually
 * reaches git, lands a tree in the store, and records the commit git resolved.
 * No network: same approach as `lib/skills/install-git.test.ts`.
 *
 * Only the identity, the capability, the flag, the registry read, and the git
 * commit of `access/skills.yaml` are stubbed.
 */

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const loadAccessMock = vi.fn();
vi.mock("@/lib/authority/access", () => ({ loadAccess: () => loadAccessMock() }));

const isSkillsEnabledMock = vi.fn();
vi.mock("@/lib/skills/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/config")>();
  return { ...actual, isSkillsEnabled: () => isSkillsEnabledMock() };
});

const loadSkillRegistryMock = vi.fn();
vi.mock("@/lib/skills/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/registry")>();
  return { ...actual, loadSkillRegistry: (...args: unknown[]) => loadSkillRegistryMock(...args) };
});

const writeSkillsMock = vi.fn();
vi.mock("@/lib/skills/store", () => ({
  writeSkills: (...args: unknown[]) => writeSkillsMock(...args),
  removeInstalledSkill: vi.fn(),
}));

const { POST } = await import("./route");

let tmpRoot: string;
let remote: string;
let remoteUrl: string;
const savedEnv = { ...process.env };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeFixture(rel: string, content: string): void {
  const abs = path.join(remote, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/skills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function storeDir(slug: string): string {
  return path.join(tmpRoot, "store", slug);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skills-route-git-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");

  remote = path.join(tmpRoot, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-b", "main");
  git(remote, "config", "user.email", "fixture@example.com");
  git(remote, "config", "user.name", "Fixture");
  writeFixture(
    "skills/brand/SKILL.md",
    ["---", "name: Brand Guidelines", "description: How we write.", "---", "", "Body.", ""].join("\n"),
  );
  writeFixture("skills/brand/references/style.md", "Style notes.\n");
  writeFixture("README.md", "Fixture repo.\n");
  git(remote, "add", "-A");
  git(remote, "commit", "-m", "initial");
  remoteUrl = `file://${remote}`;

  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("POST /api/admin/skills install-git against a real repository", () => {
  it("clones the subdir, lands it in the store, and records the resolved commit", async () => {
    const head = git(remote, "rev-parse", "HEAD");

    const response = await POST(
      post({
        action: "install-git",
        url: remoteUrl,
        ref: "main",
        subdir: "skills/brand",
        groups: ["eng"],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      slug: "brand-guidelines",
      replaced: false,
      commit: head,
    });
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toContain(
      "Brand Guidelines",
    );
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "references/style.md"), "utf8")).toContain(
      "Style notes",
    );
    expect(writeSkillsMock).toHaveBeenCalledWith(
      {
        verb: "add",
        entry: {
          slug: "brand-guidelines",
          title: "Brand Guidelines",
          source: { type: "git", url: remoteUrl, ref: "main", subdir: "skills/brand", commit: head },
          groups: ["eng"],
          compat: { scripts: [], tools: [] },
        },
      },
      "admin@example.com",
    );
  });

  it("reports a ref the repository does not carry, and lands nothing", async () => {
    const response = await POST(
      post({ action: "install-git", url: remoteUrl, ref: "no-such-ref", groups: ["eng"] }),
    );
    const body = (await response.json()) as { error: { code: string }; reason: string };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(body.reason).not.toContain(tmpRoot);
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it("refuses a subdir that climbs out of the clone", async () => {
    const response = await POST(
      post({ action: "install-git", url: remoteUrl, ref: "main", subdir: "../../etc", groups: ["eng"] }),
    );

    expect(response.status).toBe(400);
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it("refuses a remote that would be read as a git flag", async () => {
    const response = await POST(
      post({ action: "install-git", url: "--upload-pack=touch /tmp/pwned", ref: "main", groups: ["eng"] }),
    );

    expect(response.status).toBe(400);
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it("refuses a slug already registered under a different source type, before landing anything", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "brand-guidelines",
          title: "Brand Guidelines",
          source: { type: "zip", filename: "brand.zip" },
          groups: ["eng"],
          compat: { scripts: [], tools: [] },
        },
      ],
      errors: [],
    });

    const response = await POST(
      post({
        action: "install-git",
        url: remoteUrl,
        ref: "main",
        subdir: "skills/brand",
        groups: ["eng"],
      }),
    );
    const body = (await response.json()) as { error: { code: string }; reason: string };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(writeSkillsMock).not.toHaveBeenCalled();
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("still allows a same-type replace of an already registered slug", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "brand-guidelines",
          title: "Brand Guidelines",
          source: { type: "git", url: remoteUrl, ref: "main", subdir: "skills/brand", commit: "old111" },
          groups: ["eng"],
          compat: { scripts: [], tools: [] },
        },
      ],
      errors: [],
    });

    const response = await POST(
      post({
        action: "install-git",
        url: remoteUrl,
        ref: "main",
        subdir: "skills/brand",
        groups: ["eng"],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, slug: "brand-guidelines", replaced: true });
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toContain(
      "Brand Guidelines",
    );
  });
});
