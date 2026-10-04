import { dictationBackendUrl } from "./config";

/**
 * Server-side speech-to-text (spec 24). Sends the captured audio to the
 * configured transcription backend and returns the recognized text. The audio
 * is held only for the length of this call: it is never written to disk and no
 * copy is kept once the text comes back.
 *
 * Returns a discriminated result rather than throwing on a "no backend / bad
 * response" condition so the route can map it to a clean status; a genuinely
 * unexpected transport error still rejects and is caught by the route's 500.
 */
export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<TranscribeResult> {
  const url = dictationBackendUrl();
  if (!url) return { ok: false, error: "transcription backend is not configured" };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      ...(process.env.DICTATION_API_KEY ? { Authorization: `Bearer ${process.env.DICTATION_API_KEY}` } : {}),
    },
    body: new Uint8Array(audio),
  });
  if (!res.ok) return { ok: false, error: `transcription failed (${res.status})` };

  const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "transcription returned no text" };
  return { ok: true, text };
}
