import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const isEnabledMock = vi.fn();
vi.mock("@/lib/dictate/config", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/dictate/config")>();
  return {
    ...actual,
    isDictationEnabled: () => isEnabledMock(),
  };
});

const transcribeMock = vi.fn();
vi.mock("@/lib/dictate/transcribe", () => ({
  transcribeAudio: (...args: unknown[]) => transcribeMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function post(audio?: File): Request {
  const form = new FormData();
  if (audio) form.set("audio", audio);
  return new Request("http://localhost/api/dictate", { method: "POST", body: form });
}

const clip = () => new File([new Uint8Array([1, 2, 3])], "clip.webm", { type: "audio/webm" });

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isEnabledMock.mockReset().mockReturnValue(true);
  transcribeMock.mockReset().mockResolvedValue({ ok: true, text: "hello world" });
  delete process.env.DICTATION_MAX_BYTES;
});

afterEach(() => {
  delete process.env.DICTATION_MAX_BYTES;
});

describe("POST /api/dictate", () => {
  it("401s without an identity, never transcribing", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await POST(post(clip()));
    expect(res.status).toBe(401);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("404s when dictation is not enabled/configured", async () => {
    isEnabledMock.mockReturnValue(false);
    const res = await POST(post(clip()));
    expect(res.status).toBe(404);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("400s a missing audio clip", async () => {
    const res = await POST(post(undefined));
    expect(res.status).toBe(400);
  });

  it("returns the transcribed text and does not auto-send", async () => {
    const res = await POST(post(clip()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello world" });
  });

  it("503s cleanly when the backend is unavailable", async () => {
    transcribeMock.mockResolvedValue({ ok: false, error: "backend down" });
    const res = await POST(post(clip()));
    expect(res.status).toBe(503);
  });

  it("413s an over-cap clip before allocating a buffer or transcribing", async () => {
    process.env.DICTATION_MAX_BYTES = "2";
    const big = new File([new Uint8Array([1, 2, 3, 4, 5])], "big.webm", { type: "audio/webm" });
    const res = await POST(post(big));
    expect(res.status).toBe(413);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("accepts the codecs parameter MediaRecorder reports, which is what a real clip carries", async () => {
    const real = new File([new Uint8Array([1, 2, 3])], "clip.webm", { type: "audio/webm;codecs=opus" });
    const res = await POST(post(real));
    expect(res.status).toBe(200);
    // The backend is handed the type as recorded, parameter included.
    expect(transcribeMock).toHaveBeenCalledWith(expect.anything(), "audio/webm;codecs=opus");
  });

  it("400s a non-audio MIME type, never transcribing", async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], "x.exe", { type: "application/x-msdownload" });
    const res = await POST(post(bad));
    expect(res.status).toBe(400);
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
