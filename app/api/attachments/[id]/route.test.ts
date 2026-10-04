import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storeAttachment, attachmentDirFor } from "@/lib/attachments/store";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const dropWarmSessionSoonMock = vi.fn();
vi.mock("@/lib/agent/session-factory", () => ({
  dropWarmSessionSoon: (...args: unknown[]) => dropWarmSessionSoonMock(...args),
}));

const { DELETE } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
let tmp: string;

function del(id: string, threadId = "t1"): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/attachments/${id}?threadId=${threadId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  ];
}

function seed(filename: string, threadId = "t1"): string {
  return storeAttachment({
    ownerEmail: IDENTITY.email,
    threadId,
    filename,
    mimeType: "text/plain",
    bytes: Buffer.from(filename),
  }).id;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attach-del-"));
  process.env.ATTACHMENTS_DIR = tmp;
  process.env.ATTACHMENTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  dropWarmSessionSoonMock.mockReset();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
  delete process.env.ATTACHMENTS_ENABLED;
});

describe("DELETE /api/attachments/[id]", () => {
  it("401s without an identity, deleting nothing", async () => {
    const id = seed("keep.txt");
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    expect((await DELETE(...del(id))).status).toBe(401);
    expect(fs.readdirSync(attachmentDirFor(IDENTITY.email, "t1"))).toHaveLength(1);
  });

  it("404s when the flag is off, deleting nothing", async () => {
    const id = seed("keep.txt");
    delete process.env.ATTACHMENTS_ENABLED;
    expect((await DELETE(...del(id))).status).toBe(404);
    expect(fs.readdirSync(attachmentDirFor(IDENTITY.email, "t1"))).toHaveLength(1);
  });

  it("removes exactly one file and leaves its siblings alone", async () => {
    const target = seed("gone.txt");
    seed("stays-one.txt");
    seed("stays-two.txt");
    const res = await DELETE(...del(target));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    const left = fs.readdirSync(attachmentDirFor(IDENTITY.email, "t1"));
    expect(left).toHaveLength(2);
    expect(left.join(" ")).not.toContain("gone.txt");
  });

  it("404s a thread the caller does not own, deleting nothing", async () => {
    const id = seed("keep.txt");
    isOwnedByMock.mockReturnValue(false);
    const res = await DELETE(...del(id));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
    expect(fs.readdirSync(attachmentDirFor(IDENTITY.email, "t1"))).toHaveLength(1);
  });

  it("404s an unknown id with the same body as a foreign thread", async () => {
    seed("keep.txt");
    const res = await DELETE(...del("99999999-9999-4999-8999-999999999999"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
    expect(fs.readdirSync(attachmentDirFor(IDENTITY.email, "t1"))).toHaveLength(1);
  });

  it("refuses a traversal id, never reaching a file outside the thread dir", async () => {
    const outside = path.join(tmp, "outside.txt");
    fs.writeFileSync(outside, "OUTSIDE");
    const res = await DELETE(...del("../../outside"));
    expect(res.status).toBe(404);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("400s a missing threadId", async () => {
    const id = seed("keep.txt");
    const res = await DELETE(new Request(`http://localhost/api/attachments/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });

  it("evicts the warm session so the next turn stops listing the deleted file", async () => {
    const id = seed("gone.txt");
    await DELETE(...del(id));
    expect(dropWarmSessionSoonMock).toHaveBeenCalledWith("t1");
  });
});
