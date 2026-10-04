import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { addVersion, createDoc, getDocForOwner } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { DEFAULT_DOC_FORMAT, isDocFormat, type DocFormat } from "@/lib/documents/types";

/**
 * The `doc_write` tool logic behind spec 29's canvas, kept as a plain function
 * so it is directly unit-testable against `openDb(":memory:")` without the SDK.
 * `lib/doc-mcp/server.ts` wraps it as an in-process MCP tool.
 *
 * A chat document is scoped to its SOURCE THREAD. The tool proves the caller owns
 * the current thread (`isOwnedBy(getThreadId())`) before creating OR revising, so
 * an agent can never mint a document against a thread it does not own. A revision
 * (with `docId`) is additionally scoped to the current thread: the document must
 * belong to `getThreadId()`, so an agent in thread B cannot revise thread A's
 * document by supplying its id. A foreign-thread `docId`, an unknown `docId`, and
 * an unowned current thread all raise the SAME error (no existence oracle).
 */

const MAX_TITLE = 120;

/** What the tool needs from the owning session: identity + the live thread id. */
export interface DocToolContext {
  db: DatabaseType;
  getThreadId(): string;
  ownerEmail: string;
}

export interface DocWriteInput {
  title?: string;
  body: string;
  docId?: string;
  format?: DocFormat;
}

export interface DocWriteResult {
  docId: string;
  version: number;
  title: string;
  format: DocFormat;
}

/**
 * The format this call writes, or a throw.
 *
 * Never coerces. An unrecognised value stored as markdown would be invisible:
 * `proseSkipHtml` drops raw HTML rather than printing it, so the author would
 * get an empty document and no indication of why. A refusal is loud and the
 * assistant can retry.
 */
function resolveFormat(input: DocWriteInput): DocFormat {
  const requested = input.format ?? DEFAULT_DOC_FORMAT;
  if (!isDocFormat(requested)) {
    throw new Error(`doc_write does not know the format ${String(requested)}. Use "md" or "html".`);
  }
  if (requested !== DEFAULT_DOC_FORMAT && !isHtmlDocumentsEnabled()) {
    throw new Error(`doc_write cannot use the format ${requested} here: designed documents are not enabled.`);
  }
  return requested;
}

/** The first line of a body, with markdown heading marks or HTML tags taken off. */
function firstLineOf(body: string, format: DocFormat): string {
  if (format === "html") {
    const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(body)?.[1];
    const source = heading ?? body;
    return source.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  return body.split(/\r?\n/).find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
}

/** A bounded title: the explicit one, else the first line of the body, else a default. */
function deriveTitle(title: string | undefined, body: string, format: DocFormat): string {
  const explicit = title?.trim();
  if (explicit) return explicit.length > MAX_TITLE ? explicit.slice(0, MAX_TITLE) : explicit;
  const firstLine = firstLineOf(body, format);
  if (!firstLine) return "Untitled document";
  return firstLine.length > MAX_TITLE ? firstLine.slice(0, MAX_TITLE) : firstLine;
}

/**
 * Create a new chat document (version 1) bound to the current thread + owner, or
 * append a new version to an existing document the caller owns. Throws on an
 * empty body, and on a `docId` the caller does not own (foreign or unknown,
 * indistinguishable).
 */
export function docWrite(context: DocToolContext, input: DocWriteInput): DocWriteResult {
  const body = input.body;
  if (typeof body !== "string" || body.trim() === "") {
    throw new Error("doc_write requires a non-empty body.");
  }
  // Before any ownership lookup and before any write: a refused format must
  // leave the table exactly as it found it, including the version counter.
  const format = resolveFormat(input);
  const { db, ownerEmail } = context;
  const threadId = context.getThreadId();

  // The caller must own the CURRENT thread to create or revise anything in it. An
  // unowned/foreign current thread is treated exactly like a missing document.
  const NOT_FOUND = (docId?: string) =>
    new Error(docId ? `No chat document found with id ${docId}.` : "This conversation cannot capture a document.");
  if (!isOwnedBy(db, threadId, ownerEmail)) {
    throw input.docId ? NOT_FOUND(input.docId) : NOT_FOUND();
  }

  if (input.docId) {
    const doc = getDocForOwner(db, input.docId, ownerEmail);
    // Scoped to docId + owner + THIS thread: a document from another thread (even
    // one the same owner owns) cannot be revised here. Foreign/unknown identical.
    if (!doc || doc.threadId !== threadId) {
      throw NOT_FOUND(input.docId);
    }
    const version = addVersion(db, input.docId, ownerEmail, body, { format });
    if (version === false) {
      throw NOT_FOUND(input.docId);
    }
    return { docId: input.docId, version, title: doc.title, format };
  }

  const id = randomUUID();
  const title = deriveTitle(input.title, body, format);
  // createDoc is itself fail-closed (re-verifies thread ownership); a false return
  // would mean the thread ownership vanished between the check above and the write.
  if (!createDoc(db, { id, threadId, ownerEmail, title, body, format })) {
    throw NOT_FOUND();
  }
  return { docId: id, version: 1, title, format };
}
