import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Config surface for voice dictation (spec 24). Dictation is a pure input aid:
 * the mic streams audio to `POST /api/dictate`, which transcribes server-side
 * and returns text for the composer field. No audio is persisted after
 * transcription.
 *
 * Two gates, both must hold for the mic to be live:
 *  - `DICTATION_ENABLED` (default off): the feature flag.
 *  - a configured transcription backend (`DICTATION_API_URL`): without it the
 *    control degrades to disabled + tooltip rather than a broken button.
 */

/** Whether the dictation feature flag is switched on. */
export function isDictationFlagEnabled(): boolean {
  return isFlagEnabled("DICTATION_ENABLED");
}

/** Audio MIME types the dictation route accepts (checked before buffering). */
export const ALLOWED_AUDIO_TYPES: readonly string[] = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
];

/**
 * The type/subtype with any parameters stripped, which is what the allow-list
 * above is a list of. `MediaRecorder` reports its type with a codecs parameter
 * once recording has started ("audio/webm;codecs=opus" in Chrome), and that
 * string is what the uploaded clip carries.
 */
export function audioTypeEssence(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

/** Whether a clip's declared type is one the route will transcribe. */
export function isAllowedAudioType(type: string): boolean {
  return ALLOWED_AUDIO_TYPES.includes(audioTypeEssence(type));
}

/**
 * Hard cap on an uploaded audio clip. Overridable via `DICTATION_MAX_BYTES`;
 * defaults to 10 MB, generous for a short dictation clip but bounded so a
 * hostile client cannot make the route buffer an unbounded body.
 */
export function maxAudioBytes(): number {
  const raw = Number(process.env.DICTATION_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 1024 * 1024;
}

/** The transcription backend URL, if one is configured. */
export function dictationBackendUrl(): string | undefined {
  const url = process.env.DICTATION_API_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}

/**
 * The single source of truth for "is dictation usable right now": the flag is
 * on AND a backend is configured. The composer disables the mic (with a
 * tooltip) whenever this is false, and the route refuses.
 */
export function isDictationEnabled(): boolean {
  return isDictationFlagEnabled() && dictationBackendUrl() !== undefined;
}
