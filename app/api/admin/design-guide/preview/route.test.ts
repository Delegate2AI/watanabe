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

const previewDesignGuideMock = vi.fn();
vi.mock("@/lib/design-guide/preview", () => ({
  previewDesignGuide: (...args: unknown[]) => previewDesignGuideMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };
const PAGE = "<!doctype html><html><body><h1>Northwind</h1></body></html>";

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/design-guide/preview", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isHtmlDocumentsEnabledMock.mockReset().mockReturnValue(true);
  previewDesignGuideMock.mockReset().mockResolvedValue({ ok: true, html: PAGE });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/design-guide/preview", () => {
  it("renders the sample against the unsaved guide", async () => {
    const response = await POST(post({ text: "HOUSE STYLE\n\nWide margins." }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ html: PAGE });
    expect(previewDesignGuideMock).toHaveBeenCalledWith("HOUSE STYLE\n\nWide margins.");
  });

  it("is 404 with the flag off, and spends no model call", async () => {
    isHtmlDocumentsEnabledMock.mockReturnValue(false);
    expect((await POST(post({ text: "HOUSE" }))).status).toBe(404);
    expect(previewDesignGuideMock).not.toHaveBeenCalled();
  });

  it("is 403 without manageAccess, and spends no model call", async () => {
    canMock.mockReturnValue(false);
    expect((await POST(post({ text: "HOUSE" }))).status).toBe(403);
    expect(previewDesignGuideMock).not.toHaveBeenCalled();
  });

  it("refuses to preview a guide that could not be saved", async () => {
    // Same checker as the save path. Previewing guidance an admin would then be
    // refused when they pressed Save is a loop that teaches the wrong thing, and
    // this way a doomed run costs nothing.
    const response = await POST(post({ text: "HOUSE\n<script>x</script>" }));
    expect(response.status).toBe(400);
    expect((await response.json()).problems[0].line).toBe(2);
    expect(previewDesignGuideMock).not.toHaveBeenCalled();
  });

  it("answers 429 when too many previews are already running", async () => {
    previewDesignGuideMock.mockResolvedValue({ ok: false, error: "busy" });
    expect((await POST(post({ text: "HOUSE STYLE\n\nWide." }))).status).toBe(429);
  });

  it("reports a model failure as an upstream failure, not as a bad request", async () => {
    previewDesignGuideMock.mockResolvedValue({ ok: false, error: "failed" });
    expect((await POST(post({ text: "HOUSE STYLE\n\nWide." }))).status).toBe(502);
  });

  it("rejects a body that is not the expected shape", async () => {
    expect((await POST(post({ guide: "HOUSE" }))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
  });
});
