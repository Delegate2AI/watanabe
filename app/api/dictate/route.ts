import { requireIdentity } from "@/lib/auth/identity";
import { isDictationEnabled, maxAudioBytes, isAllowedAudioType } from "@/lib/dictate/config";
import { transcribeAudio } from "@/lib/dictate/transcribe";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dictate (multipart) → transcribe captured audio to text.
 *
 * Purely an input aid: it returns `{ text }` for the composer to insert, it
 * does not send anything. The audio is transcribed in-request and never
 * persisted. Gated by `isDictationEnabled` (flag on AND a backend configured):
 * flag-off or backend-absent the route 404s and the mic renders disabled with a
 * tooltip, never a broken button. Identity is required so the endpoint is not
 * an open transcription proxy.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("dictate request rejected", { route: "POST /api/dictate", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  if (!isDictationEnabled()) return fail("not_found");

  // Bound the body BEFORE reading it: reject an over-cap upload on its declared
  // Content-Length so a hostile client cannot make the route buffer an unbounded
  // request. A missing/garbage length still gets a second, exact size check
  // after parsing, below.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxAudioBytes()) {
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return fail("invalid_request", { detail: "audio" });
  }
  // MIME allowlist and exact size check BEFORE allocating the buffer.
  if (!isAllowedAudioType(audio.type)) {
    // The rejected type is the caller's own string; echoing it back makes the
    // body a reflection surface for no gain.
    return fail("invalid_request", { detail: "audio" });
  }
  if (audio.size > maxAudioBytes()) {
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  try {
    const bytes = Buffer.from(await audio.arrayBuffer());
    const result = await transcribeAudio(bytes, audio.type || "audio/webm");
    if (!result.ok) {
      log.warn("dictate transcription unavailable", {
        route: "POST /api/dictate",
        status: 503,
        owner: identity.email,
        reason: result.error,
      });
      return fail("internal", { status: 503 });
    }
    // No audio is retained: `bytes` is a local buffer that goes out of scope
    // here, nothing is written to disk.
    return Response.json({ text: result.text });
  } catch (e) {
    log.error("dictate request failed", {
      route: "POST /api/dictate",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
