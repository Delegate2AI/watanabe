import type { ErrorCode } from "./codes";

/**
 * The failure contract's client half: the one place a reason code becomes a
 * sentence a person reads.
 *
 * Pure and client-importable on purpose. There is no `node:` import here and
 * there must never be one: this table is imported from client islands, where a
 * filesystem import is a hard Turbopack failure. The only import is a type-only
 * one, which erases at build time, so nothing from `codes.ts` reaches the
 * bundle either.
 *
 * The property that matters: `messageFor` never puts its input in its output. A
 * backend code that ships before its copy renders a bland sentence, and an
 * internal string mistakenly passed as a code renders that same bland sentence.
 * That is what makes the leak class impossible rather than merely fixed.
 */

/**
 * What the user sees when the code is unrecognized. Deliberately says nothing
 * about the system: it must be safe to render in response to a code nobody has
 * ever seen before.
 */
export const GENERIC_MESSAGE =
  "Something went wrong. Try again, or contact an admin if it keeps happening.";

/**
 * Code to copy. Exhaustive by type: adding an `ErrorCode` without adding a line
 * here fails to typecheck, so a new backend reason can never quietly fall
 * through to the generic sentence in production.
 *
 * Copy rules, enforced by the sibling test: no environment variable name, no
 * file path, no route, no mention of the code itself. Each line says what
 * happened and, where there is one, what to do next.
 */
export const MESSAGES: Record<ErrorCode, string> = {
  not_cleared: "You are not cleared for this item.",
  not_assignee: "Only the person this is assigned to can complete it.",
  terminal: "This is already closed.",
  wrong_status: "That action does not apply in this state.",
  needs_role: "You need editor access to do that. Ask an admin.",
  write_unavailable:
    "Publishing is unavailable: this deployment has no write access to the knowledge base.",
  review_unavailable:
    "Your change was saved to a branch, but the request to review it could not be opened. Ask an admin to open it.",
  llm_unavailable: "The LLM gateway is unavailable right now. Try again in a minute, or ask an admin.",
  not_found: "That item no longer exists, or you cannot see it.",
  invalid_request: "That request was not valid. Check the form and try again.",
  unsupported_file: "That kind of file cannot be imported. Upload a Markdown or Word document.",
  file_too_large: "That file is too large to import. Upload a smaller one.",
  unreadable_file: "That file could not be read. It may be empty, damaged, or not the format its name suggests.",
  conflict: "Someone else changed this first. Reload and try again.",
  alias_taken:
    "That address is already in use, either as its own account or as another person's alias. Remove it there first, or use a different address.",
  alias_same_address: "That is already this person's own address, so it does not need an alias.",
  internal: "Something went wrong on our side. Try again in a moment.",
};

/**
 * Turn a reason code into user-facing copy.
 *
 * Accepts a plain `string` rather than `ErrorCode` because the value arrives off
 * the wire, where the type system does not reach: a newer server can legitimately
 * send a code this build has never heard of. Anything unrecognized, including a
 * non-string, an inherited property name, or a whole internal sentence, returns
 * the generic message. The input is never interpolated into the result.
 */
export function messageFor(code: string | null | undefined): string {
  if (typeof code !== "string" || code === "") return GENERIC_MESSAGE;
  // `Object.hasOwn`, not `code in MESSAGES` and not a bare index: a bare lookup
  // would resolve "toString" to a function off Object.prototype.
  if (!Object.hasOwn(MESSAGES, code)) return GENERIC_MESSAGE;
  return MESSAGES[code as ErrorCode];
}

/**
 * Pull the reason code out of a parsed error response body.
 *
 * Returns `undefined` for a legacy `{ error: "<free text>" }` payload, which is
 * the important case while routes are still being migrated: an unmigrated route's
 * internal sentence yields no code, so `messageFor` renders the generic message
 * instead of the raw string. A half-migrated app therefore degrades to bland
 * copy, never to a leak.
 */
export function codeFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

/**
 * The full client path: a parsed body in, a sentence out. Everything that is not
 * a recognized code collapses to the generic sentence.
 */
export function messageForBody(body: unknown): string {
  return messageFor(codeFromBody(body));
}
