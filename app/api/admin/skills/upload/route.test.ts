import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const installFromZipMock = vi.fn();
vi.mock("@/lib/skills/install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/install")>();
  return { ...actual, installFromZip: (...args: unknown[]) => installFromZipMock(...args) };
});

const invalidateMaterializedSkillsMock = vi.fn();
vi.mock("@/lib/skills/materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/materialize")>();
  return {
    ...actual,
    invalidateMaterializedSkills: (...args: unknown[]) => invalidateMaterializedSkillsMock(...args),
  };
});

const { POST, dynamic, runtime } = await import("./route");
const { DEFAULT_MAX_SKILL_UPLOAD_BYTES } = await import("@/lib/skills/config");

const INSTALLED = {
  ok: true,
  slug: "pdf-tools",
  validation: {
    ok: true,
    name: "PDF Tools",
    slug: "pdf-tools",
    description: "does things",
    compat: { scripts: [], tools: [], urls: [], blockedScripts: [] },
  },
  source: { type: "zip", filename: "pdf.zip" },
};

const ZIP_BYTES = Buffer.from("PK pretend archive");

type UploadOptions = {
  filename?: string;
  type?: string;
  groups?: string | null;
  omitFile?: boolean;
  headers?: Record<string, string | null>;
};

/**
 * The multipart body is encoded up front so the request carries a real
 * content-length that an override can then contradict, exactly as
 * `app/api/packages/route.test.ts` does it.
 */
async function upload(options: UploadOptions = {}): Promise<Request> {
  const form = new FormData();
  if (options.omitFile !== true) {
    const file = new File([new Uint8Array(ZIP_BYTES)], options.filename ?? "pdf.zip", {
      type: options.type ?? "application/zip",
    });
    form.set("file", file);
  }
  if (options.groups !== null) form.set("groups", options.groups ?? JSON.stringify(["eng"]));

  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", encoded.headers.get("content-type") ?? "");
  headers.set("content-length", String(body.byteLength));
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request("http://localhost/api/admin/skills/upload", { method: "POST", headers, body });
}

let storeRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-upload-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  installFromZipMock.mockReset().mockResolvedValue(INSTALLED);
  invalidateMaterializedSkillsMock.mockReset();
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("POST /api/admin/skills/upload", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("caps an upload at 20MB by default", () => {
    expect(DEFAULT_MAX_SKILL_UPLOAD_BYTES).toBe(20_000_000);
  });

  it("401s without an identity, before extracting", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(await upload())).status).toBe(401);
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    expect((await POST(await upload())).status).toBe(404);
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess, before touching the body", async () => {
    canMock.mockReturnValue(false);

    const response = await POST(await upload());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(installFromZipMock).not.toHaveBeenCalled();
    expect(loadAccessMock).not.toHaveBeenCalled();
  });

  it.each([null, "not-a-number", "0", "-5"])(
    "411s a content-length of %s, the only shape that could stream unbounded",
    async (value) => {
      const response = await POST(await upload({ headers: { "content-length": value } }));

      expect(response.status).toBe(411);
      expect(installFromZipMock).not.toHaveBeenCalled();
    },
  );

  it("413s a declared length over the cap, before parsing the body", async () => {
    const response = await POST(await upload({ headers: { "content-length": "999999999999" } }));

    expect(response.status).toBe(413);
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it("413s the actual bytes even when the declared length understates them", async () => {
    process.env.PORTAL_SKILLS_MAX_UPLOAD_BYTES = "10";

    const response = await POST(await upload({ headers: { "content-length": "5" } }));

    expect(response.status).toBe(413);
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a content type that is not a zip", { type: "text/plain" }],
    ["a filename that is not a zip", { filename: "skill.tar.gz" }],
    ["no file part at all", { omitFile: true }],
    ["groups that are not a JSON array", { groups: "eng" }],
    ["no groups field", { groups: null }],
  ])("rejects %s with 400 and never extracts", async (_label, options: UploadOptions) => {
    const response = await POST(await upload(options));

    expect(response.status).toBe(400);
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it("rejects a group key access does not declare, without extracting", async () => {
    const response = await POST(await upload({ groups: JSON.stringify(["ghosts"]) }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("groups");
    expect(installFromZipMock).not.toHaveBeenCalled();
  });

  it("extracts the archive and records the entry", async () => {
    const response = await POST(await upload());

    expect(installFromZipMock).toHaveBeenCalledTimes(1);
    const [opts] = installFromZipMock.mock.calls[0] as [{ filename: string; data: Buffer }];
    expect(opts.filename).toBe("pdf.zip");
    expect(Buffer.from(opts.data).equals(ZIP_BYTES)).toBe(true);
    expect(writeSkillsMock).toHaveBeenCalledWith(
      {
        verb: "add",
        entry: {
          slug: "pdf-tools",
          title: "PDF Tools",
          source: { type: "zip", filename: "pdf.zip" },
          groups: ["eng"],
          compat: { scripts: [], tools: [] },
        },
      },
      "admin@example.com",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "pdf-tools", replaced: false });
    expect(invalidateMaterializedSkillsMock).toHaveBeenCalled();
  });

  it("reports an extraction refusal without leaking an absolute path", async () => {
    installFromZipMock.mockResolvedValue({
      ok: false,
      reason: "zip entry escapes the skill folder: /var/data/.skill-install-a1/evil",
    });

    const response = await POST(await upload());
    const body = (await response.json()) as { error: { code: string }; reason: string };

    expect(response.status).toBe(400);
    expect(body.reason).toContain("zip entry escapes");
    expect(body.reason).not.toContain("/var/data");
  });

  it("rolls the store directory back when the registry write fails", async () => {
    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });
    writeSkillsMock.mockResolvedValue({ ok: false, error: "invalid skill entry" });

    const response = await POST(await upload());

    expect(response.status).toBe(400);
    expect(existsSync(path.join(storeRoot, "pdf-tools"))).toBe(false);
  });
});
