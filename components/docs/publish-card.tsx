"use client";

import { useState } from "react";
import { VisibilityPicker } from "@/components/artifacts/visibility-picker";
import { PublishConfirmDialog } from "@/components/artifacts/publish-confirm-dialog";
import { KbPathPicker } from "@/components/docs/kb-path-picker";
import { slugifyTitle } from "@/lib/artifacts/suggest-path";
import { kbDocHref } from "@/lib/kb/doc-path";
import { joinTargetPath, splitTargetPath } from "@/lib/kb/target-path";
import { messageForBody } from "@/lib/errors/messages";
import type { KbTargetOptions } from "@/lib/kb/target-options";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";
import { useChangeRequestTerms } from "@/components/app-config-provider";

export interface DocPublication {
  status: "in_review" | "published";
  targetPath: string;
  targetVisibility: string[];
  publishedNotePath: string | null;
  mrUrl: string | null;
}

/**
 * "Publish to the knowledge base" for a shared doc (spec 2026-08-11).
 *
 * Deliberately NOT `components/artifacts/publish-panel.tsx`. That panel locks
 * its controls once an artifact is in review or published, which is right for an
 * artifact (editing it would diverge the stored copy from what reviewers read)
 * and wrong here: a shared doc keeps being edited, and a later revision is worth
 * publishing again. So this stays editable and says what a second publish does.
 * The two genuinely shared pieces, the visibility picker and the direct-publish
 * confirmation, are imported rather than reimplemented.
 *
 * Rendered by the page only for the owner, and only with the flag on. The route
 * re-checks both.
 */
export function PublishCard({
  docId,
  docTitle,
  publication,
  targets,
  visibilityOptions,
  canPublishDirect,
}: {
  docId: string;
  docTitle: string;
  publication: DocPublication | null;
  targets: KbTargetOptions;
  visibilityOptions: VisibilityOptions;
  canPublishDirect: boolean;
}) {
  const terms = useChangeRequestTerms();
  // A prior publish keeps its destination; a first publish starts at the top
  // level with a name suggested from the document title, editable like the rest.
  const initial = publication ? splitTargetPath(publication.targetPath) : { folder: "", name: slugifyTitle(docTitle) };
  const [folder, setFolder] = useState(initial.folder);
  const [name, setName] = useState(initial.name);
  const [visibility, setVisibility] = useState((publication?.targetVisibility ?? ["all-hands"]).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DocPublication | null>(publication);

  const targetPath = joinTargetPath(folder, name);
  // The backend keeps an existing note's own frontmatter, visibility included
  // (spec 2026-08-11, "Frontmatter is never authored by the proposer"), so a
  // picker on that path would silently decide nothing.
  const targetExists = targetPath !== "" && targets.notes.some((note) => note.path === targetPath);

  async function publish(mode: "mr" | "direct"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/docs/${docId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          targetPath,
          targetVisibility: visibility.split(",").map((g) => g.trim()).filter(Boolean),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(messageForBody(body));
        return;
      }
      const published = body as { mode: "mr" | "direct"; mrUrl?: string; notePath: string };
      setResult({
        status: published.mode === "mr" ? "in_review" : "published",
        targetPath,
        targetVisibility: visibility.split(",").map((g) => g.trim()).filter(Boolean),
        publishedNotePath: published.notePath,
        mrUrl: published.mrUrl ?? null,
      });
    } catch {
      setError("The document could not be published.");
    } finally {
      setBusy(false);
    }
  }

  const noteHref = result?.publishedNotePath ? kbDocHref(result.publishedNotePath) : null;

  return (
    <section className="rounded-chip border border-line bg-surface-2 p-4" aria-label="Publish to the knowledge base">
      <h2 className="mb-3 text-sm font-semibold text-ink">Publish to the knowledge base</h2>

      {result ? (
        <p className="mb-3 text-xs text-ink-muted">
          {result.status === "published" ? (
            <>
              Published.
              {noteHref ? (
                <>
                  {" "}
                  <a href={noteHref} className="font-medium text-ink underline">
                    Open in the knowledge base
                  </a>
                </>
              ) : null}
            </>
          ) : (
            <>
              {/* Not "published": the note is proposed until someone merges it,
                  and saying otherwise is what stopped contributors chasing the
                  review on the artifact surface. */}
              Waiting on review. It is not in the knowledge base until its {terms.long} is merged.
              {result.mrUrl ? (
                <>
                  {" "}
                  <a href={result.mrUrl} target="_blank" rel="noreferrer" className="font-medium text-ink underline">
                    Open {terms.long}
                  </a>
                </>
              ) : null}
            </>
          )}
        </p>
      ) : null}

      <div className="mb-3">
        <KbPathPicker
          options={targets}
          folder={folder}
          name={name}
          disabled={busy}
          onFolderChange={setFolder}
          onNameChange={setName}
        />
      </div>

      <div className="mb-3 block text-xs font-medium text-ink-muted">
        {targetExists ? "Visibility (kept from the existing note)" : "Visibility (groups and people)"}
        <div className="mt-1">
          {targetExists ? (
            <p className="text-xs font-normal text-ink-muted">
              An update keeps the note&apos;s own visibility. Use Manage access on the note to change it.
            </p>
          ) : (
            <VisibilityPicker value={visibility} onChange={setVisibility} options={visibilityOptions} disabled={busy} />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void publish("mr")}
          disabled={busy || targetPath === ""}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {result ? "Publish this revision" : "Request review"}
        </button>
        {canPublishDirect ? (
          <PublishConfirmDialog
            targetPath={targetPath}
            visibility={visibility}
            busy={busy || targetPath === ""}
            onConfirm={() => void publish("direct")}
          />
        ) : null}
        <p className="basis-full text-xs text-ink-muted">
          {result
            ? `Publishing again opens a new ${terms.long} for the document as it stands now.`
            : `Request review opens a ${terms.long}. It reaches the knowledge base when an approver merges it.`}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
