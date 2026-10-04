"use client";

import { VisibilityPicker } from "./visibility-picker";
import { PublishConfirmDialog } from "./publish-confirm-dialog";
import { PublishSteps } from "./publish-steps";
import { kbDocHref } from "@/lib/kb/doc-path";
import type { ArtifactStatus } from "@/lib/db/artifacts";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";
import { useChangeRequestTerms } from "@/components/app-config-provider";

/**
 * The publish panel (spec 27): set the target `docs/` path and visibility, mark
 * the artifact ready, then publish it to the KB. Presentational and controlled:
 * the parent editor owns the values and the fetch actions. The Publish controls
 * are only rendered when `canPublish` (spec 22 write role + KB write enabled);
 * a viewer never sees them. Direct publish (straight to main) is additionally
 * gated by `canPublishDirect` (approver).
 */
export function PublishPanel({
  status,
  targetPath,
  visibility,
  visibilityOptions,
  visibilityLocked = false,
  targetFolders,
  canPublish,
  canPublishDirect,
  mrUrl,
  publishedNotePath,
  busy,
  onTargetPathChange,
  onVisibilityChange,
  onMarkReady,
  onPublish,
}: {
  status: ArtifactStatus;
  targetPath: string;
  visibility: string;
  visibilityOptions: VisibilityOptions;
  /**
   * The target note already exists, so ITS visibility governs and the value
   * held here is never consulted at publish (`lib/kb-write/existing-note.ts`).
   * Shown read-only rather than as a picker, because a control that silently
   * decides nothing is worse than no control.
   */
  visibilityLocked?: boolean;
  targetFolders: string[];
  canPublish: boolean;
  canPublishDirect: boolean;
  /** The open merge request, when one was opened for this artifact. */
  mrUrl: string | null;
  /** Where the note landed, once published. */
  publishedNotePath: string | null;
  busy: boolean;
  onTargetPathChange: (v: string) => void;
  onVisibilityChange: (v: string) => void;
  onMarkReady: () => void;
  onPublish: (mode: "mr" | "direct") => void;
}) {
  const terms = useChangeRequestTerms();
  const published = status === "published";
  const inReview = status === "in_review";
  // Both terminal-ish states freeze the destination: once a merge request is
  // open against a path, editing that path here would describe a destination
  // the open MR does not target.
  const locked = published || inReview;
  const noteHref = publishedNotePath ? kbDocHref(publishedNotePath) : null;
  return (
    <section className="rounded-chip border border-line bg-surface-2 p-4" aria-label="Publish">
      <h2 className="mb-3 text-sm font-semibold text-ink">Publish to the knowledge base</h2>
      <PublishSteps status={status} />
      <label className="mb-2 block text-xs font-medium text-ink-muted">
        Target path (under docs/)
        <input
          type="text"
          value={targetPath}
          list="artifact-target-folders"
          disabled={locked || busy}
          onChange={(e) => onTargetPathChange(e.target.value)}
          placeholder={targetFolders[0] ? `${targetFolders[0]}/risk-disclosure.md` : "risk-disclosure.md"}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
        />
        <datalist id="artifact-target-folders">
          {targetFolders.map((folder) => (
            <option key={folder} value={`${folder}/`}>{`${folder}/`}</option>
          ))}
        </datalist>
      </label>
      <div className="mb-3 block text-xs font-medium text-ink-muted">
        {visibilityLocked ? "Visibility (inherited from the existing note)" : "Visibility (groups and people)"}
        <div className="mt-1">
          {visibilityLocked ? (
            <p className="text-xs font-normal text-ink">
              {visibility.trim() === "" ? "all-hands" : visibility}
              <span className="ml-2 text-ink-muted">
                An edit keeps the note&apos;s own visibility. Use Manage access on the note to change it.
              </span>
            </p>
          ) : (
            <VisibilityPicker
              value={visibility}
              onChange={onVisibilityChange}
              options={visibilityOptions}
              disabled={locked || busy}
            />
          )}
        </div>
      </div>
      {published ? (
        <p className="text-xs text-good">
          This artifact has been published.
          {noteHref ? (
            <>
              {" "}
              <a href={noteHref} className="font-medium underline">
                Open in the knowledge base
              </a>
            </>
          ) : null}
        </p>
      ) : inReview ? (
        // Deliberately not "published": the note is proposed, not live. Saying
        // otherwise made contributors stop chasing the review.
        <p className="text-xs text-ink-muted">
          This artifact is waiting on review. It is not in the knowledge base until its {terms.long} is merged.
          {/* The link lives here, not in the editor's post-action notice: that
              notice is empty on a fresh load, which left a reopened in-review
              artifact saying "waiting on review" with no way to reach it. */}
          {mrUrl ? (
            <>
              {" "}
              <a
                href={mrUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink underline"
              >
                Open {terms.long}
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === "draft" ? (
            <button
              type="button"
              onClick={onMarkReady}
              disabled={busy || targetPath.trim() === ""}
              className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-surface disabled:opacity-60"
            >
              Mark ready
            </button>
          ) : null}
          {status === "draft" ? (
            <p className="basis-full text-xs text-ink-muted">
              Mark ready confirms this destination and audience. You can then request review, which
              opens a {terms.long} for an approver to merge.
            </p>
          ) : null}
          {canPublish && status === "ready" ? (
            <button
              type="button"
              onClick={() => onPublish("mr")}
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              Request review
            </button>
          ) : null}
          {canPublish && canPublishDirect && status === "ready" ? (
            <PublishConfirmDialog
              targetPath={targetPath}
              visibility={visibility}
              busy={busy}
              onConfirm={() => onPublish("direct")}
            />
          ) : null}
          {canPublish && status === "ready" ? (
            <p className="basis-full text-xs text-ink-muted">
              {canPublishDirect
                ? `Request review opens a ${terms.long} for an approver to merge. Publish now goes live immediately.`
                : `Request review opens a ${terms.long}. It reaches the knowledge base when an approver merges it.`}
            </p>
          ) : null}
          {!canPublish && status === "ready" ? (
            <p className="text-xs text-ink-muted">
              You do not have permission to publish. Ask an editor to publish this artifact.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
