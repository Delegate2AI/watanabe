/**
 * Minimal structured logger — one JSON object per line to stdout/stderr, so an
 * operator tailing `kubectl logs` (or any JSON log pipeline) can filter by
 * level and read the fields, instead of the near-silence the app shipped with
 * (two bare `console` lines in instrumentation.ts and nothing on the request
 * path). Deliberately dependency-free: no pino/winston, no new package, no
 * transport config — just `console.*(JSON.stringify(...))`.
 *
 * No timestamp is emitted: the container runtime already stamps every stdout
 * line, and `Date.now()`/`new Date()` are avoided so this stays trivially
 * usable from anywhere without pulling wall-clock state into otherwise-pure
 * code paths. If a timestamp is ever needed, add it at the log pipeline, not
 * here.
 *
 * Usage:
 *   import { log } from "@/lib/log";
 *   log.info("turn complete", { owner, sessionId, costUsd });
 *   log.error("db write failed", { op: "recordThread", err: String(e) });
 */

type Fields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

/** Receives every `log.error`, so failures reach more than stderr. */
type ErrorSink = (msg: string, fields?: Fields) => void;

let errorSink: ErrorSink | null = null;

/**
 * Registers where errors go besides stderr (see `lib/analytics/server.ts`).
 *
 * A seam rather than a direct import: this module is dependency-free on
 * purpose, and most of the app reports failure by logging rather than throwing,
 * so this is the one place that sees them all.
 */
export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

function emit(level: Level, msg: string, fields?: Fields): void {
  // One line, one JSON object. `msg`/`level` are fixed keys; caller fields are
  // spread alongside. `console.error` for warn/error so they land on stderr and
  // are easy to separate from info-level chatter.
  const record: Fields = { level, msg, ...fields };
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // A field held something non-serializable (a cycle, a BigInt, …). Never let
    // logging itself throw on the request path — fall back to a safe rendering.
    line = JSON.stringify({ level, msg, logError: "unserializable fields" });
  }
  if (level === "info") {
    console.log(line);
  } else {
    console.error(line);
  }
  if (level === "error" && errorSink) {
    try {
      errorSink(msg, fields);
    } catch {
      // A failing sink must not turn a logged error into a thrown one.
    }
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
