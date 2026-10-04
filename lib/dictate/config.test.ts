import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDictationEnabled,
  isDictationFlagEnabled,
  dictationBackendUrl,
  maxAudioBytes,
  ALLOWED_AUDIO_TYPES,
  audioTypeEssence,
  isAllowedAudioType,
} from "./config";

const ORIGINAL = { flag: process.env.DICTATION_ENABLED, url: process.env.DICTATION_API_URL };

beforeEach(() => {
  delete process.env.DICTATION_ENABLED;
  delete process.env.DICTATION_API_URL;
});
afterEach(() => {
  if (ORIGINAL.flag === undefined) delete process.env.DICTATION_ENABLED;
  else process.env.DICTATION_ENABLED = ORIGINAL.flag;
  if (ORIGINAL.url === undefined) delete process.env.DICTATION_API_URL;
  else process.env.DICTATION_API_URL = ORIGINAL.url;
});

describe("dictation config", () => {
  it("is off by default", () => {
    expect(isDictationFlagEnabled()).toBe(false);
    expect(isDictationEnabled()).toBe(false);
  });

  it("requires BOTH the flag and a backend url to be usable", () => {
    process.env.DICTATION_ENABLED = "1";
    expect(isDictationEnabled()).toBe(false); // flag on, no backend
    process.env.DICTATION_API_URL = "https://stt.internal/transcribe";
    expect(isDictationEnabled()).toBe(true);
    expect(dictationBackendUrl()).toBe("https://stt.internal/transcribe");
  });

  it("stays off with a backend but no flag", () => {
    process.env.DICTATION_API_URL = "https://stt.internal/transcribe";
    expect(isDictationEnabled()).toBe(false);
  });

  it("bounds the audio size (default 10 MB, env-overridable)", () => {
    expect(maxAudioBytes()).toBe(10 * 1024 * 1024);
    process.env.DICTATION_MAX_BYTES = "2048";
    expect(maxAudioBytes()).toBe(2048);
    delete process.env.DICTATION_MAX_BYTES;
  });

  it("allow-lists common audio MIME types", () => {
    expect(ALLOWED_AUDIO_TYPES).toContain("audio/webm");
    expect(ALLOWED_AUDIO_TYPES).not.toContain("application/x-msdownload");
  });

  it("matches on the essence, so a MediaRecorder codecs parameter still passes", () => {
    // What Chrome reports in `onstop`, and what Safari reports for its own container.
    expect(isAllowedAudioType("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedAudioType("audio/mp4; codecs=mp4a.40.2")).toBe(true);
    expect(isAllowedAudioType("AUDIO/WEBM")).toBe(true);
    expect(isAllowedAudioType("application/x-msdownload;codecs=opus")).toBe(false);
    expect(isAllowedAudioType("")).toBe(false);
  });

  it("strips parameters and normalizes case when reading the essence", () => {
    expect(audioTypeEssence("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(audioTypeEssence(" Audio/OGG ; codecs=vorbis")).toBe("audio/ogg");
    expect(audioTypeEssence("audio/wav")).toBe("audio/wav");
  });
});
