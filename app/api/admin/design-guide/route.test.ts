import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isHtmlDocumentsEnabledMock = vi.fn();
vi.mock("@/lib/documents/config", () => ({
  isHtmlDocumentsEnabled: () => isHtmlDocumentsEnabledMock(),
}));

const loadDesignGuideMock = vi.fn();
vi.mock("@/lib/design-guide/store", () => ({
  loadDesignGuide: () => loadDesignGuideMock(),
}));

const writeDesignGuideMock = vi.fn();
vi.mock("@/lib/design-guide/write", () => ({
  writeDesignGuide: (...args: unknown[]) => writeDesignGuideMock(...args),
}));

import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { DESIGN_CONSTRAINTS } from "@/lib/agent/design-prompt";

const { GET, PUT, dynamic, runtime } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };

function put(body: unknown): Request {
  return new Request("http://localhost/api/admin/design-guide", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isHtmlDocumentsEnabledMock.mockReset().mockReturnValue(true);
  loadDesignGuideMock.mockReset().mockReturnValue({ text: DEFAULT_DESIGN_HOUSE_STYLE, source: "default" });
  writeDesignGuideMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("route conventions", () => {
  it("is dynamic and runs on node, like every other route here", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });
});

describe("GET /api/admin/design-guide", () => {
  it("returns the guide, the built-in default, and the assembled prompt", async () => {
    const body = await (await GET(new Request("http://localhost/api/admin/design-guide"))).json();
    expect(body.guide.source).toBe("default");
    expect(body.builtIn).toBe(DEFAULT_DESIGN_HOUSE_STYLE);
    // Without this an admin edits one half of a text they cannot see.
    expect(body.assembled).toContain(DESIGN_CONSTRAINTS);
    expect(body.assembled).toContain(DEFAULT_DESIGN_HOUSE_STYLE);
  });

  it("is 404 with the flag off, before the capability is consulted", async () => {
    isHtmlDocumentsEnabledMock.mockReturnValue(false);
    const response = await GET(new Request("http://localhost/api/admin/design-guide"));
    expect(response.status).toBe(404);
    // Flag-off must answer an admin and a viewer identically, so the capability
    // check never runs and cannot become a timing oracle.
    expect(canMock).not.toHaveBeenCalled();
  });

  it("is 403 for a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);
    expect((await GET(new Request("http://localhost/api/admin/design-guide"))).status).toBe(403);
  });
});

describe("PUT /api/admin/design-guide", () => {
  it("saves the guide", async () => {
    const response = await PUT(put({ text: "HOUSE STYLE\n\nWide margins." }));
    expect(response.status).toBe(200);
    expect(writeDesignGuideMock).toHaveBeenCalledWith("HOUSE STYLE\n\nWide margins.", IDENTITY.email);
  });

  it("is 404 with the flag off, and never reaches the write path", async () => {
    isHtmlDocumentsEnabledMock.mockReturnValue(false);
    expect((await PUT(put({ text: "HOUSE" }))).status).toBe(404);
    expect(writeDesignGuideMock).not.toHaveBeenCalled();
  });

  it("is 403 for a caller without manageAccess, and never reaches the write path", async () => {
    canMock.mockReturnValue(false);
    expect((await PUT(put({ text: "HOUSE" }))).status).toBe(403);
    expect(writeDesignGuideMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not the expected shape", async () => {
    expect((await PUT(put({ guide: "HOUSE" }))).status).toBe(400);
    expect((await PUT(put("not json"))).status).toBe(400);
  });

  it("returns the offending lines, so a refusal can be located in the editor", async () => {
    writeDesignGuideMock.mockResolvedValue({
      ok: false,
      error: "invalid design guide",
      problems: [{ line: 4, reason: "no script" }],
    });
    const response = await PUT(put({ text: "HOUSE" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.problems).toEqual([{ line: 4, reason: "no script" }]);
  });

  it("does not forward a failed commit's message, which is git output", async () => {
    writeDesignGuideMock.mockResolvedValue({ ok: false, error: "fatal: could not read from /srv/x" });
    const response = await PUT(put({ text: "HOUSE" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("/srv/x");
  });
});
