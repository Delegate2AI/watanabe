import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
const writeAliasMock = vi.fn();
/** Stands in for the file the write path commits and the route re-reads. */
let map: Record<string, string[]> = {};

vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));
vi.mock("@/lib/authority/aliases-store", () => ({
  writeAlias: (...args: unknown[]) => writeAliasMock(...args),
  loadAliasMap: () => map,
}));

import { POST, dynamic, runtime } from "./route";

const CANONICAL = "maria.chen@example.com";
const ALIAS = "maria.personal@example.test";

function post(body: unknown): Request {
  return new Request("http://t/api/admin/aliases", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  map = {};
  writeAliasMock.mockReset().mockImplementation(async (change: { verb: string; email: string; alias: string }) => {
    const current = map[change.email] ?? [];
    map[change.email] = change.verb === "addAlias"
      ? [...new Set([...current, change.alias])].sort()
      : current.filter((entry) => entry !== change.alias);
    return { ok: true, aliases: map[change.email] };
  });
  process.env.AUTHORITY_ENABLED = "1";
  process.env.ALIASES_ADMIN_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("POST /api/admin/aliases", () => {
  it("uses the required route runtime conventions and commits the alias", async () => {
    const response = await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: CANONICAL, aliases: [ALIAS] });
    expect(writeAliasMock).toHaveBeenCalledWith(
      { verb: "addAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
    );
  });

  it("removes an alias", async () => {
    map = { [CANONICAL]: [ALIAS] };

    const response = await POST(post({ verb: "removeAlias", email: CANONICAL, alias: ALIAS }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: CANONICAL, aliases: [] });
  });

  it("is a bare 404 with the flag off, before it looks at identity at all", async () => {
    process.env.ALIASES_ADMIN_ENABLED = "0";

    const response = await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("is a bare 404 while authority itself is dormant", async () => {
    process.env.AUTHORITY_ENABLED = "0";

    expect((await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }))).status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin before parsing or writing", async () => {
    canMock.mockReturnValue(false);

    const response = await POST(post("not-json"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(writeAliasMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body without naming anything internal", async () => {
    const response = await POST(post("not-json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "body" } });
  });

  it("rejects an unknown verb and any extra field", async () => {
    expect((await POST(post({ verb: "grant", email: CANONICAL, alias: ALIAS }))).status).toBe(400);
    expect((await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS, role: "admin" }))).status).toBe(400);
    expect((await POST(post({ verb: "addAlias", email: CANONICAL, alias: "nonsense" }))).status).toBe(400);
    expect(writeAliasMock).not.toHaveBeenCalled();
  });

  it("maps each store rejection onto its error code", async () => {
    const cases = [
      ["not_found", 404, "not_found"],
      ["taken", 409, "alias_taken"],
      ["self", 409, "alias_same_address"],
      ["invalid", 400, "invalid_request"],
      ["unavailable", 503, "write_unavailable"],
    ] as const;

    for (const [reason, status, code] of cases) {
      writeAliasMock.mockResolvedValueOnce({ ok: false, reason });
      const response = await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code } });
    }
  });

  // An address that is already spoken for is not a lost race. Reporting it as
  // `conflict` told the admin to "Reload and try again", which can never work:
  // the registry is exactly as they left it and the second attempt is refused
  // for the same reason as the first.
  it("does not report a taken address as a concurrent edit", async () => {
    writeAliasMock.mockResolvedValueOnce({ ok: false, reason: "taken" });
    const response = await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }));
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).not.toBe("conflict");
  });

  it("reports a write that did not land rather than confirming it", async () => {
    // The store claims success but the file does not carry the alias, which is
    // what a swallowed commit failure would look like from here.
    writeAliasMock.mockResolvedValue({ ok: true, aliases: [ALIAS] });
    map = {};

    const response = await POST(post({ verb: "addAlias", email: CANONICAL, alias: ALIAS }));

    expect(response.status).toBe(502);
  });

  it("reports a removal that did not land", async () => {
    writeAliasMock.mockResolvedValue({ ok: true, aliases: [] });
    map = { [CANONICAL]: [ALIAS] };

    expect((await POST(post({ verb: "removeAlias", email: CANONICAL, alias: ALIAS }))).status).toBe(502);
  });
});
