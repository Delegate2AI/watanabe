import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { addVersion, getVersions, insertSharedDoc, latestVersionOf, renameSharedDoc } from "@/lib/db/shared-docs";
import { attachableFor, insertProjectReference } from "@/lib/db/project-references";
import { getProjectForRequester } from "@/lib/db/projects";
import { isProjectsEnabled } from "@/lib/projects/config";
import { accessFor, canEdit, canManage, canRead, type EffectiveAccess } from "./access";
import { shareClearanceFor } from "./clearance";

export interface SharedDocToolContext {
  db: DatabaseType;
  ownerEmail: string;
}

export type ToolOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

const UNREACHABLE_DOC = "This document is not available to you.";
const UNREACHABLE_PROJECT = "This project is not available to you.";
const MAX_TITLE = 120;

function rejectBadTitle(title: string): string | null {
  if (!title) return "A title cannot be empty.";
  if (title.length > MAX_TITLE) return `Title is longer than ${MAX_TITLE} characters.`;
  return null;
}

export function sharedDocCreate(
  ctx: SharedDocToolContext,
  input: { title: string; body: string },
): ToolOutcome<{ docId: string; version: number }> {
  const title = input.title.trim();
  const badTitle = rejectBadTitle(title);
  if (badTitle) return { ok: false, error: badTitle };
  if (!input.body) return { ok: false, error: "A body is required." };

  const docId = randomUUID();
  insertSharedDoc(ctx.db, { id: docId, title, ownerEmail: ctx.ownerEmail, body: input.body });
  return { ok: true, result: { docId, version: 1 } };
}

export function sharedDocUpdate(
  ctx: SharedDocToolContext,
  input: { docId: string; title?: string; body?: string },
): ToolOutcome<{ version: number; yourAccess: EffectiveAccess }> {
  const access = accessFor(ctx.db, input.docId, ctx.ownerEmail, shareClearanceFor(ctx.ownerEmail));
  if (!canRead(access)) return { ok: false, error: UNREACHABLE_DOC };

  const title = input.title?.trim();
  if (title !== undefined) {
    const badTitle = rejectBadTitle(title);
    if (badTitle) return { ok: false, error: badTitle };
    if (!canManage(access)) {
      return { ok: false, error: "Only the document's owner can change its title." };
    }
  }
  if (input.body !== undefined && !canEdit(access)) {
    return { ok: false, error: "You do not have edit access to this document." };
  }

  const current = latestVersionOf(ctx.db, input.docId);
  const existing = getVersions(ctx.db, input.docId);
  let version = existing.length > 0 ? existing[existing.length - 1].version : 1;

  if (input.body !== undefined) {
    const appended = addVersion(ctx.db, input.docId, ctx.ownerEmail, input.body, {
      format: current?.format,
    });
    if (appended === false) return { ok: false, error: UNREACHABLE_DOC };
    version = appended;
  }
  if (title !== undefined) renameSharedDoc(ctx.db, input.docId, ctx.ownerEmail, title);

  return { ok: true, result: { version, yourAccess: access } };
}

export function sharedDocAttach(
  ctx: SharedDocToolContext,
  input: { projectId: string; docId: string },
): ToolOutcome<{ attached: boolean }> {
  if (!isProjectsEnabled()) return { ok: false, error: UNREACHABLE_PROJECT };

  const clearance = resolveClearance(ctx.ownerEmail, loadGroups());
  const project = getProjectForRequester(ctx.db, input.projectId, ctx.ownerEmail, clearance);
  if (!project) return { ok: false, error: UNREACHABLE_PROJECT };

  const reachable = attachableFor(ctx.db, ctx.ownerEmail).some(
    (candidate) => candidate.kind === "shared_doc" && candidate.targetId === input.docId,
  );
  if (!reachable) return { ok: false, error: UNREACHABLE_DOC };

  const attached = insertProjectReference(ctx.db, {
    id: randomUUID(),
    projectId: input.projectId,
    kind: "shared_doc",
    targetId: input.docId,
    addedBy: ctx.ownerEmail,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, result: { attached } };
}
