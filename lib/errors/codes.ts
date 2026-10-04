/**
 * The failure contract's server half: one closed set of reason codes, one status
 * per code, and the single helper every route returns a failure through.
 *
 * Why a code and not a sentence: before this module, four internal strings
 * shipped as user-facing copy, one of them an environment variable name. A route
 * that can only name a code cannot leak an internal string into a response body,
 * because there is nowhere in the payload for free text to travel unless the
 * caller passes it deliberately (`message` for logs, `detail` for a field name).
 * The prose lives on the client, in `lib/errors/messages.ts`.
 *
 * Pure by design: no `node:` import, no config read, nothing stateful. It is
 * importable from a client component as well as a route, which is what lets one
 * module define the vocabulary both halves speak.
 */

/**
 * Every reason a request can fail. Adding a member here forces a status below
 * and a message in `lib/errors/messages.ts`, both of which are exhaustive
 * `Record<ErrorCode, ...>` maps, so a code without copy or a status is a type
 * error rather than a runtime surprise.
 */
export const ERROR_CODES = [
  "not_cleared",
  "not_assignee",
  "terminal",
  "wrong_status",
  "needs_role",
  "write_unavailable",
  "review_unavailable",
  "llm_unavailable",
  "not_found",
  "invalid_request",
  "unsupported_file",
  "file_too_large",
  "unreadable_file",
  "conflict",
  "alias_taken",
  "alias_same_address",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The HTTP status each code answers with.
 *
 * `not_found` covers both "no such id" and "you may not see this id": the
 * no-oracle property depends on those two being indistinguishable, so they share
 * one code and one status. `write_unavailable` is 503 rather than 500 because it
 * is a deployment precondition (no write access to the knowledge base), not a
 * fault in the request or in the handler.
 *
 * The three file codes are separate from `invalid_request` because a document
 * import fails in ways a person can act on, and "check the form and try again"
 * is useless advice for a file that is the wrong type or too big.
 * `file_too_large` is 413 rather than 400 for the same reason it is its own
 * code: the request is well formed, it is the size that is refused.
 *
 * The two alias codes share 409 with `conflict` but are separate for the reason
 * the file codes are separate from `invalid_request`: "reload and try again" is
 * useless advice for an address that is already spoken for, because the registry
 * is exactly as the admin left it and the next attempt is refused identically.
 *
 * `review_unavailable` is 502 for the same reason it is its own code: the write
 * itself succeeded (the branch is pushed) and only the upstream call that turns
 * it into a reviewable merge request failed, which is neither a bad request nor
 * a fault in this handler. It is distinct from `write_unavailable` because the
 * change is not lost, so the copy must not tell the caller to try again.
 *
 * `llm_unavailable` is 503 and its own code because the LLM gateway (9router)
 * is a separate service: it can be unconfigured or briefly locked out while the
 * knowledge base write path is fine, so `write_unavailable`'s copy would be wrong.
 */
export const STATUS: Record<ErrorCode, number> = {
  not_cleared: 403,
  not_assignee: 403,
  terminal: 409,
  wrong_status: 409,
  needs_role: 403,
  write_unavailable: 503,
  review_unavailable: 502,
  llm_unavailable: 503,
  not_found: 404,
  invalid_request: 400,
  unsupported_file: 400,
  file_too_large: 413,
  unreadable_file: 400,
  conflict: 409,
  alias_taken: 409,
  alias_same_address: 409,
  internal: 500,
};

export interface FailOptions {
  /**
   * An operator-facing sentence. Logged and available to a client that does not
   * recognize the code, but never rendered: `messageFor(code)` owns the copy.
   * Callers must pass a literal, never a caught error's message, so a stack or a
   * credential cannot reach a response body through this field.
   */
  message?: string;
  /**
   * A machine-readable pointer at what was wrong, typically a field name.
   * Same rule: literals only.
   */
  detail?: string;
  /** Override the mapped status for the rare route that needs a different one. */
  status?: number;
}

/** The exact shape every failing route now returns. */
export interface ErrorPayload {
  error: {
    code: ErrorCode;
    message?: string;
    detail?: string;
  };
}

/**
 * Build the failure response for `code`.
 *
 * Nothing is derived from ambient state: `message` and `detail` appear only when
 * the caller names them, so `fail("write_unavailable")` is a three-word body with
 * no room for an environment variable name, a stack, or a file path.
 */
export function fail(code: ErrorCode, opts: FailOptions = {}): Response {
  const payload: ErrorPayload = { error: { code } };
  if (opts.message !== undefined) payload.error.message = opts.message;
  if (opts.detail !== undefined) payload.error.detail = opts.detail;
  return Response.json(payload, { status: opts.status ?? STATUS[code] });
}
