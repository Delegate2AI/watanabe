import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  getDocForOwner,
  getPromotions,
  latestVersion,
  recordPromotion,
  type PromotionTarget,
} from "@/lib/db/chat-docs";
import {
  insertArtifact,
  getArtifactForOwner,
  getVersions as artifactVersions,
  addVersion as artifactAddVersion,
} from "@/lib/db/artifacts";
import {
  insertSharedDoc,
  getVersions as sharedVersions,
  addVersion as sharedAddVersion,
} from "@/lib/db/shared-docs";
import { accessFor, canRead, canEdit } from "@/lib/shared-docs/access";
import type { DocFormat } from "@/lib/documents/types";
import { isArtifactsEnabled } from "@/lib/artifacts/config";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import { holdForDoc } from "@/lib/content/hold";
import { classifyUpdate, type UpdateClassification } from "./divergence";

/**
 * Promotion + additive Update (spec 29): seed a spec-27 artifact or a spec-28
 * shared doc from a chat document's current version, then push later chat-doc
 * versions as new target versions on an explicit Update, never silently.
 *
 * This goes THROUGH the existing artifact/shared-doc stores AND their access
 * rules. The artifact path is owner-scoped (`getArtifactForOwner` /
 * owner-scoped versions + append), and it stays a `draft` (owner-private until
 * separately published to the KB by spec 27's write path, which promotion never
 * touches). The shared-doc path resolves the spec-28 ACL seam
 * (`accessFor` + `canRead` for status, `canEdit` for an Update append), so a
 * promotion row pointing at a shared doc the owner cannot access exposes nothing
 * and cannot be written: an inaccessible target is treated identically to a
 * missing one.
 *
 * Every chat-doc path is source-thread-ownership scoped (getDocForOwner /
 * latestVersion / getPromotions), so a foreign or unknown chat-doc id both
 * surface as `not_found` (no existence oracle).
 */

export type PromoteFailure =
  | { ok: false; reason: "disabled" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "compliance_hold"; gates: string[]; message: string };

export type PromoteResult =
  | { ok: true; targetType: PromotionTarget; targetId: string; promotedVersion: number; targetVersion: number }
  | PromoteFailure;

export type UpdateResult =
  | { ok: true; targetType: PromotionTarget; targetId: string; newTargetVersion: number; classification: UpdateClassification }
  | {
      ok: false;
      reason: "disabled" | "not_found" | "up_to_date" | "diverged" | "compliance_hold";
      classification?: UpdateClassification;
    };

function targetEnabled(target: PromotionTarget): boolean {
  return target === "artifact" ? isArtifactsEnabled() : isSharedDocsEnabled();
}

export interface PromotionStatus {
  targetType: PromotionTarget;
  targetId: string;
  promotedVersion: number;
  targetVersionAtPromote: number;
  targetCurrentVersion: number;
  classification: UpdateClassification;
}

/**
 * Per-target Update status for a chat document: for each recorded promotion,
 * the target's live current version and the divergence classification (so the
 * pane can show Update only when the chat doc is ahead, and warn when the target
 * moved on its own). Owner-scoped through the chat document; empty for a foreign
 * or unknown id.
 */
export function promotionStatuses(db: DatabaseType, docId: string, ownerEmail: string): PromotionStatus[] {
  const latest = latestVersion(db, docId, ownerEmail);
  if (!latest) return [];
  const out: PromotionStatus[] = [];
  for (const p of getPromotions(db, docId, ownerEmail)) {
    const targetCurrent = targetCurrentVersion(db, p.targetType, p.targetId, ownerEmail);
    // An inaccessible target (foreign artifact, or a shared doc the owner cannot
    // read) is treated as missing: it is simply not surfaced, exposing nothing.
    if (targetCurrent === null) continue;
    out.push({
      targetType: p.targetType,
      targetId: p.targetId,
      promotedVersion: p.promotedVersion,
      targetVersionAtPromote: p.targetVersionAtPromote,
      targetCurrentVersion: targetCurrent,
      classification: classifyUpdate({
        chatCurrentVersion: latest.version,
        promotedVersion: p.promotedVersion,
        targetCurrentVersion: targetCurrent,
        targetVersionAtPromote: p.targetVersionAtPromote,
      }),
    });
  }
  return out;
}

/**
 * The target's live current version, enforcing the target's OWN access rules, or
 * `null` when the target is inaccessible (a foreign artifact, or a shared doc the
 * owner cannot read) so callers treat it identically to a missing target.
 */
function targetCurrentVersion(
  db: DatabaseType,
  target: PromotionTarget,
  targetId: string,
  ownerEmail: string,
): number | null {
  if (target === "artifact") {
    if (!getArtifactForOwner(db, targetId, ownerEmail)) return null;
    const versions = artifactVersions(db, targetId, ownerEmail);
    return versions.length > 0 ? versions[versions.length - 1].version : 0;
  }
  if (!canRead(accessFor(db, targetId, ownerEmail))) return null;
  const versions = sharedVersions(db, targetId);
  return versions.length > 0 ? versions[versions.length - 1].version : 0;
}

/** Create the target seeded from `body`, returning its new id. */
function createTarget(
  db: DatabaseType,
  target: PromotionTarget,
  seed: {
    title: string;
    body: string;
    format: DocFormat;
    ownerEmail: string;
    sourceThreadId?: string | null;
  },
): string {
  const id = randomUUID();
  if (target === "artifact") {
    insertArtifact(db, {
      id,
      title: seed.title,
      ownerEmail: seed.ownerEmail,
      sourceThreadId: seed.sourceThreadId ?? null,
      body: seed.body,
      format: seed.format,
    });
  } else {
    insertSharedDoc(db, {
      id,
      title: seed.title,
      ownerEmail: seed.ownerEmail,
      body: seed.body,
      format: seed.format,
    });
  }
  return id;
}

/**
 * Append a new version to the target, enforcing the target's own write rules,
 * returning its new version number or `null` when the target is inaccessible
 * (foreign artifact, or a shared doc the owner cannot edit): the caller maps a
 * `null` to `not_found`, identical to a missing target.
 */
function pushTargetVersion(
  db: DatabaseType,
  target: PromotionTarget,
  targetId: string,
  ownerEmail: string,
  body: string,
  format: DocFormat,
): number | null {
  if (target === "artifact") {
    // Owner-scoped: a foreign artifact writes zero rows and returns false.
    const ok = artifactAddVersion(db, targetId, ownerEmail, body, { format });
    if (!ok) return null;
    return targetCurrentVersion(db, "artifact", targetId, ownerEmail);
  }
  // Spec-28 ACL: only an edit-access principal may append a shared-doc version.
  if (!canEdit(accessFor(db, targetId, ownerEmail))) return null;
  const version = sharedAddVersion(db, targetId, ownerEmail, body, { format });
  return version === false ? null : version;
}

/**
 * Promote the chat document's current version to a new target. Records a
 * promotion (chat-doc version + the target's version 1 at snapshot) so Update
 * and divergence have their reference points.
 */
export function promote(
  db: DatabaseType,
  args: { docId: string; ownerEmail: string; target: PromotionTarget; sourceThreadId?: string | null },
): PromoteResult {
  if (!targetEnabled(args.target)) return { ok: false, reason: "disabled" };
  const doc = getDocForOwner(db, args.docId, args.ownerEmail);
  const latest = latestVersion(db, args.docId, args.ownerEmail);
  if (!doc || !latest) return { ok: false, reason: "not_found" };
  // Both targets, not just `artifact`: a shared doc is itself a KB publish path
  // (lib/shared-docs/publish.ts) and, with external sharing on, a signed-link
  // channel that reaches past logged-in staff.
  const hold = holdForDoc(db, args.docId, args.ownerEmail);
  if (hold.held) return { ok: false, reason: "compliance_hold", gates: hold.gates, message: hold.message ?? "" };

  const targetId = createTarget(db, args.target, {
    title: doc.title,
    body: latest.body,
    format: latest.format,
    ownerEmail: args.ownerEmail,
    sourceThreadId: args.sourceThreadId ?? doc.threadId,
  });
  recordPromotion(db, {
    docId: args.docId,
    ownerEmail: args.ownerEmail,
    targetType: args.target,
    targetId,
    promotedVersion: latest.version,
    targetVersionAtPromote: 1,
  });
  return { ok: true, targetType: args.target, targetId, promotedVersion: latest.version, targetVersion: 1 };
}

/**
 * Update a promoted target with the chat document's current version. Additive:
 * appends a new target version. Refuses silently overwriting a diverged target
 * (the target moved on its own since the promotion) unless `confirm` is set; the
 * classification is returned either way so the caller can name the divergence.
 */
export function updateTarget(
  db: DatabaseType,
  args: { docId: string; ownerEmail: string; target: PromotionTarget; confirm?: boolean },
): UpdateResult {
  if (!targetEnabled(args.target)) return { ok: false, reason: "disabled" };
  const latest = latestVersion(db, args.docId, args.ownerEmail);
  if (!latest) return { ok: false, reason: "not_found" };
  // An Update pushes the document's current body onto an already-promoted
  // target, so it is a second road to the same place and carries the same check.
  if (holdForDoc(db, args.docId, args.ownerEmail).held) return { ok: false, reason: "compliance_hold" };
  const promotion = getPromotions(db, args.docId, args.ownerEmail).find((p) => p.targetType === args.target);
  if (!promotion) return { ok: false, reason: "not_found" };

  const targetCurrent = targetCurrentVersion(db, args.target, promotion.targetId, args.ownerEmail);
  // An inaccessible target (foreign artifact, or a shared doc the owner cannot
  // read) is indistinguishable from a missing promotion.
  if (targetCurrent === null) return { ok: false, reason: "not_found" };
  const classification = classifyUpdate({
    chatCurrentVersion: latest.version,
    promotedVersion: promotion.promotedVersion,
    targetCurrentVersion: targetCurrent,
    targetVersionAtPromote: promotion.targetVersionAtPromote,
  });
  if (classification.status === "up_to_date") return { ok: false, reason: "up_to_date", classification };
  if (classification.warn && !args.confirm) return { ok: false, reason: "diverged", classification };

  const newTargetVersion = pushTargetVersion(
    db,
    args.target,
    promotion.targetId,
    args.ownerEmail,
    latest.body,
    latest.format,
  );
  if (newTargetVersion === null) return { ok: false, reason: "not_found" };
  recordPromotion(db, {
    docId: args.docId,
    ownerEmail: args.ownerEmail,
    targetType: args.target,
    targetId: promotion.targetId,
    promotedVersion: latest.version,
    targetVersionAtPromote: newTargetVersion,
  });
  return { ok: true, targetType: args.target, targetId: promotion.targetId, newTargetVersion, classification };
}
