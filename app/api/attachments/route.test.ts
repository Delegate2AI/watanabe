import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const isEnabledMock = vi.fn();
const validateMock = vi.fn();
const storeMock = vi.fn();
const maxBytesMock = vi.fn();
vi.mock("@/lib/attachments/store", () => ({
  isAttachmentsEnabled: () => isEnabledMock(),
  validateAttachment: (...args: unknown[]) => validateMock(...args),
  storeAttachment: (...args: unknown[]) => storeMock(...args),
  maxAttachmentBytes: () => maxBytesMock(),
  attachmentDirFor: (...args: unknown[]) => attachmentDirForMock(...args),
}));

const attachmentDirForMock = vi.fn();
const listAttachmentsMock = vi.fn();
vi.mock("@/lib/attachments/read", () => ({
  listAttachments: (...args: unknown[]) => listAttachmentsMock(...args),
}));

const dropWarmSessionSoonMock = vi.fn();
vi.mock("@/lib/agent/session-factory", () => ({
  dropWarmSessionSoon: (...args: unknown[]) => dropWarmSessionSoonMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const { POST, GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function upload(file?: File, threadId = "t1"): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  form.set("threadId", threadId);
  return new Request("http://localhost/api/attachments", { method: "POST", body: form });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isEnabledMock.mockReset().mockReturnValue(true);
  validateMock.mockReset().mockReturnValue({ ok: true });
  isOwnedByMock.mockReset().mockReturnValue(true);
  storeMock.mockReset().mockReturnValue({ type: "attachment", id: "x", name: "n", mimeType: "text/plain", size: 3, threadId: "t1" });
  maxBytesMock.mockReset().mockReturnValue(10 * 1024 * 1024);
  dropWarmSessionSoonMock.mockReset();
  attachmentDirForMock.mockReset();
  listAttachmentsMock.mockReset().mockReturnValue([]);
});

describe("POST /api/attachments", () => {
  it("401s without an identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await POST(upload(new File(["abc"], "a.txt", { type: "text/plain" })));
    expect(res.status).toBe(401);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("404s when the feature flag is off (degrades, no byte-path change)", async () => {
    isEnabledMock.mockReturnValue(false);
    const res = await POST(upload(new File(["abc"], "a.txt", { type: "text/plain" })));
    expect(res.status).toBe(404);
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("400s a missing file", async () => {
    const res = await POST(upload(undefined));
    expect(res.status).toBe(400);
  });

  it("400s unsupported_file on a type refusal, never touching the store", async () => {
    validateMock.mockReturnValue({ ok: false, error: `unsupported file type "application/x-msdownload"` });
    const res = await POST(upload(new File(["abc"], "a.exe", { type: "application/x-msdownload" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "unsupported_file" } });
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("413s file_too_large on a size refusal, never touching the store", async () => {
    validateMock.mockReturnValue({ ok: false, error: "file exceeds the 2 byte limit" });
    maxBytesMock.mockReturnValue(2);
    const res = await POST(upload(new File(["abcdefgh"], "a.txt", { type: "text/plain" })));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: "file_too_large" } });
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("passes the filename to the validator so the csv mime fallback can fire", async () => {
    await POST(upload(new File(["a,b"], "rows.csv", { type: "" })));
    expect(validateMock).toHaveBeenCalledWith(expect.objectContaining({ filename: "rows.csv" }));
  });

  it("evicts a warm session after a successful store so the next turn sees the file", async () => {
    await POST(upload(new File(["abc"], "a.txt", { type: "text/plain" })));
    expect(dropWarmSessionSoonMock).toHaveBeenCalledWith("t1");
  });

  it("does not evict when the upload was refused", async () => {
    validateMock.mockReturnValue({ ok: false, error: "unsupported file type" });
    await POST(upload(new File(["abc"], "a.exe", { type: "application/x-msdownload" })));
    expect(dropWarmSessionSoonMock).not.toHaveBeenCalled();
  });

  it("stores a valid upload scoped to the caller's identity and returns the chip", async () => {
    const res = await POST(upload(new File(["abc"], "a.txt", { type: "text/plain" })));
    expect(res.status).toBe(200);
    expect(storeMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "alice@example.com", threadId: "t1", filename: "a.txt", mimeType: "text/plain" }),
    );
    expect(await res.json()).toMatchObject({ attachment: { type: "attachment", threadId: "t1" } });
  });

  it("404s (identically for foreign AND unknown) a thread the caller does not own, never storing", async () => {
    isOwnedByMock.mockReturnValue(false); // covers both foreign and unknown
    const res = await POST(upload(new File(["abc"], "a.txt", { type: "text/plain" }), "someone-elses-thread"));
    expect(res.status).toBe(404);
    expect(storeMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
  });
});

describe("GET /api/attachments", () => {
  function get(threadId = "t1"): Request {
    return new Request(`http://localhost/api/attachments?threadId=${threadId}`);
  }

  it("401s without an identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    expect((await GET(get())).status).toBe(401);
    expect(listAttachmentsMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isEnabledMock.mockReturnValue(false);
    expect((await GET(get())).status).toBe(404);
    expect(listAttachmentsMock).not.toHaveBeenCalled();
  });

  it("404s a thread the caller does not own, identically for foreign and unknown", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await GET(get("someone-elses-thread"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
    expect(listAttachmentsMock).not.toHaveBeenCalled();
  });

  it("400s a missing threadId", async () => {
    expect((await GET(new Request("http://localhost/api/attachments"))).status).toBe(400);
  });

  it("returns chips for the caller's own thread, reading with the authenticated email", async () => {
    listAttachmentsMock.mockReturnValue([
      { id: "u1", name: "a.md", path: "/data/attachments/k/t1/u1-a.md", mimeType: "text/markdown", size: 4, text: "body" },
    ]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(listAttachmentsMock).toHaveBeenCalledWith("alice@example.com", "t1");
    expect(await res.json()).toEqual({
      attachments: [{ type: "attachment", id: "u1", name: "a.md", mimeType: "text/markdown", size: 4, threadId: "t1" }],
    });
  });

  it("never returns the file's content or its on-disk path", async () => {
    listAttachmentsMock.mockReturnValue([
      { id: "u1", name: "a.md", path: "/data/attachments/k/t1/u1-a.md", mimeType: "text/markdown", size: 4, text: "SECRET" },
    ]);
    const body = JSON.stringify(await (await GET(get())).json());
    expect(body).not.toContain("SECRET");
    expect(body).not.toContain("/data/attachments");
  });
});
