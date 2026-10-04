import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
const reclearMeetingMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));
vi.mock("@/lib/authority/reclearance", () => ({
  reclearMeeting: (...args: unknown[]) => reclearMeetingMock(...args),
}));

import { POST, dynamic, runtime } from "./route";

describe("POST /api/meetings/reclear", () => {
  beforeEach(() => {
    requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
    canMock.mockReset().mockReturnValue(true);
    reclearMeetingMock
      .mockReset()
      .mockResolvedValue({ ok: true, branch: "kb/admin/reclear-1", mrUrl: "https://git.example.com/mr/7" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the required route runtime conventions and submits a re-clearance", async () => {
    const request = new Request("http://t/api/meetings/reclear", {
      method: "POST",
      body: JSON.stringify({ notePath: "meetings/2026/foo.md", visibility: ["exec"] }),
    });

    const response = await POST(request);

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    // The merge request travels too: the branch alone gives the caller nothing
    // to open, which is what left a re-clearance sitting unreviewed.
    expect(await response.json()).toEqual({
      branch: "kb/admin/reclear-1",
      mrUrl: "https://git.example.com/mr/7",
    });
    expect(reclearMeetingMock).toHaveBeenCalledWith(
      "meetings/2026/foo.md",
      ["exec"],
      "admin@example.com",
    );
  });

  it.each(["viewer@example.com", "editor@example.com"])("denies %s before parsing or mutation", async (email) => {
    requireIdentityMock.mockResolvedValue({ identity: { email } });
    canMock.mockReturnValue(false);
    const request = new Request("http://t/api/meetings/reclear", { method: "POST", body: "not-json" });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(reclearMeetingMock).not.toHaveBeenCalled();
  });

  it("returns validation refusal without committing", async () => {
    reclearMeetingMock.mockResolvedValue({ ok: false, error: "valid meeting visibility is required" });
    const request = new Request("http://t/api/meetings/reclear", {
      method: "POST",
      body: JSON.stringify({ notePath: "meetings/2026/foo.md", visibility: ["unknown"] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    // The refusal is translated, never forwarded: the body names a code and
    // the field, not the re-clearance writer's own sentence.
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "notePath" } });
  });

  it("distinguishes a pushed branch with no merge request from a failed write", async () => {
    reclearMeetingMock.mockResolvedValue({ ok: false, error: "review_unavailable", branch: "kb/admin/reclear-1" });
    const request = new Request("http://t/api/meetings/reclear", {
      method: "POST",
      body: JSON.stringify({ notePath: "meetings/2026/foo.md", visibility: ["exec"] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(502);
    // The branch name is an operator-facing detail, logged by the writer. It
    // does not travel in the body, so the code is all the client learns.
    expect(await response.json()).toEqual({ error: { code: "review_unavailable" } });
  });

  it("rejects a malformed body before the service", async () => {
    const request = new Request("http://t/api/meetings/reclear", {
      method: "POST",
      body: JSON.stringify({ notePath: "meetings/2026/foo.md", visibility: [] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(reclearMeetingMock).not.toHaveBeenCalled();
  });
});
