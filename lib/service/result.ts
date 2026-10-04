import type { ErrorCode } from "@/lib/errors/codes";

/**
 * What every service function returns: a value, or a reason drawn from the one
 * closed vocabulary the failure contract already defines.
 *
 * The point of returning a code rather than a `Response` is that two surfaces
 * render the same answer differently. A route turns a failure into
 * `fail(code, ...)` and keeps its status mapping; an MCP tool turns it into
 * `messageFor(code)` and gets the sentence that was already written and tested
 * for a person to read. Neither surface invents copy, and neither has to know
 * how the other renders.
 *
 * Pure and client-importable on purpose, exactly like `lib/errors/messages.ts`:
 * the only import here is type-only and erases at build time, so nothing from
 * `codes.ts` reaches a client bundle and a `node:` import must never appear in
 * this file.
 */
export type ServiceFailure = {
  ok: false;
  code: ErrorCode;
  /** A machine-readable pointer at what was wrong, typically a field name. Literals only. */
  detail?: string;
  /** An operator-facing sentence for logs. Never rendered to a caller. Literals only. */
  message?: string;
};

export type ServiceResult<T> = { ok: true; value: T } | ServiceFailure;

export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

/**
 * Returns `ServiceFailure` rather than `ServiceResult<T>` so a service can
 * `return err("not_found")` from a function of any value type without naming a
 * type argument.
 *
 * `detail` and `message` are added only when given, never set to `undefined`.
 * Two failures for the same reason have to be deep-equal, because that identity
 * is what the no-oracle tests assert: an id that does not exist and an id the
 * caller may not see must be one answer.
 */
export function err(code: ErrorCode, opts: { detail?: string; message?: string } = {}): ServiceFailure {
  const failure: ServiceFailure = { ok: false, code };
  if (opts.detail !== undefined) failure.detail = opts.detail;
  if (opts.message !== undefined) failure.message = opts.message;
  return failure;
}
