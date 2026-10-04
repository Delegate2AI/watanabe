import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

const isMeetingsEnabledMock = vi.fn();
const isMeetingsWebhookEnabledMock = vi.fn();
const circlebackWebhookSecretMock = vi.fn();
vi.mock("@/lib/meetings/config", () => ({
  isMeetingsEnabled: () => isMeetingsEnabledMock(),
  isMeetingsWebhookEnabled: () => isMeetingsWebhookEnabledMock(),
  circlebackWebhookSecret: () => circlebackWebhookSecretMock(),
}));

const getDbMock = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => getDbMock() }));

const upsertMeetingPayloadMock = vi.fn();
vi.mock("@/lib/db/meeting-payloads", () => ({
  upsertMeetingPayload: (...args: unknown[]) => upsertMeetingPayloadMock(...args),
}));

const insertMeetingJobMock = vi.fn();
vi.mock("@/lib/db/meetings", () => ({
  insertMeetingJob: (...args: unknown[]) => insertMeetingJobMock(...args),
}));

const enqueueMeetingMock = vi.fn();
vi.mock("@/lib/meetings/queue", () => ({
  enqueueMeeting: (...args: unknown[]) => enqueueMeetingMock(...args),
}));

const { POST } = await import("./route");

const SECRET = "whsec_test";
const DB = { fake: "db" };

const BODY = JSON.stringify({
  id: "mtg-1",
  name: "Product Syncup",
  createdAt: "2026-08-05T13:00:00.000Z",
  attendees: [{ email: "alice@example.com" }],
});

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function post(body: string, signature: string | null = sign(body)): Request {
  return new Request("http://localhost/api/webhooks/circleback", {
    method: "POST",
    body,
    headers: signature === null ? {} : { "x-signature": signature },
  });
}

beforeEach(() => {
  isMeetingsEnabledMock.mockReset().mockReturnValue(true);
  isMeetingsWebhookEnabledMock.mockReset().mockReturnValue(true);
  circlebackWebhookSecretMock.mockReset().mockReturnValue(SECRET);
  getDbMock.mockReset().mockReturnValue(DB);
  upsertMeetingPayloadMock.mockReset();
  insertMeetingJobMock.mockReset();
  enqueueMeetingMock.mockReset();
});

describe("POST /api/webhooks/circleback", () => {
  it("stores the payload and enqueues the meeting for a correctly signed delivery", async () => {
    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, meetingId: "mtg-1" });
    expect(upsertMeetingPayloadMock).toHaveBeenCalledWith(DB, "mtg-1", BODY);
    expect(insertMeetingJobMock).toHaveBeenCalledWith(DB, "mtg-1");
    expect(enqueueMeetingMock).toHaveBeenCalledWith("mtg-1");
  });

  it("stores the RAW body, not a re-serialized copy", async () => {
    const raw = '{ "id":"mtg-1",  "name":"Spaced" }';
    await POST(post(raw));
    expect(upsertMeetingPayloadMock).toHaveBeenCalledWith(DB, "mtg-1", raw);
  });

  it("is a dark 404 when the webhook flag is off", async () => {
    isMeetingsWebhookEnabledMock.mockReturnValue(false);
    const response = await POST(post(BODY));
    expect(response.status).toBe(404);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("is a dark 404 when meetings ingestion itself is off", async () => {
    isMeetingsEnabledMock.mockReturnValue(false);
    expect((await POST(post(BODY))).status).toBe(404);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("refuses every delivery when no signing secret is configured", async () => {
    circlebackWebhookSecretMock.mockReturnValue(null);
    const response = await POST(post(BODY));
    expect(response.status).toBe(404);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("rejects an unsigned delivery", async () => {
    const response = await POST(post(BODY, null));
    expect(response.status).toBe(403);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
    expect(enqueueMeetingMock).not.toHaveBeenCalled();
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const response = await POST(post(BODY, sign(BODY, "whsec_wrong")));
    expect(response.status).toBe(403);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("rejects a body tampered with after signing", async () => {
    const signature = sign(BODY);
    const tampered = JSON.stringify({ id: "mtg-evil", name: "Injected" });
    const response = await POST(post(tampered, signature));
    expect(response.status).toBe(403);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const body = "not json";
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a signed JSON body with no meeting id", async () => {
    const body = JSON.stringify({ name: "No id" });
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(upsertMeetingPayloadMock).not.toHaveBeenCalled();
  });

  it("answers 500 without enqueueing when the payload cannot be stored", async () => {
    upsertMeetingPayloadMock.mockImplementation(() => {
      throw new Error("disk full");
    });
    const response = await POST(post(BODY));
    expect(response.status).toBe(500);
    expect(enqueueMeetingMock).not.toHaveBeenCalled();
  });
});
