"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "./status-pill";
import { ArtifactBody } from "./artifact-body";
import { PublishPanel } from "./publish-panel";
import { VersionHistory } from "./version-history";
import { DeleteArtifact } from "./delete-artifact";
import { suggestTargetPath } from "@/lib/artifacts/suggest-path";
import { messageForBody } from "@/lib/errors/messages";
import type { ArtifactStatus, ArtifactVersion } from "@/lib/db/artifacts";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";
import { capitalizedTerm } from "@/lib/git-host/terms";
import { useChangeRequestTerms } from "@/components/app-config-provider";

export interface EditorArtifact {
  id: string;
  title: string;
  status: ArtifactStatus;
  targetPath: string | null;
  targetVisibility: string[] | null;
  publishedNotePath: string | null;
  /** The merge request an `mr` publish opened, persisted so it survives reload. */
  mrUrl: string | null;
}

/** Parse a comma-separated visibility field into a trimmed, non-empty group list. */
function parseVisibility(raw: string): string[] {
  const groups = raw.split(",").map((g) => g.trim()).filter(Boolean);
  return groups.length > 0 ? groups : ["all-hands"];
}

/**
 * The artifact detail view (spec 27): a lightweight markdown editor (title +
 * body), the publish panel, and the version history. Every mutation goes
 * through the owner-scoped API routes; on success we `router.refresh()` so the
 * server-rendered artifact (status, versions) re-reads from the store. Heavy
 * authoring stays in chat, this is deliberately a minimal editor.
 */
export function ArtifactEditor({
  artifact,
  body: initialBody,
  versions,
  visibilityOptions,
  visibilityLocked = false,
  targetFolders,
  canPublish,
  canPublishDirect,
  richEditorEnabled = false,
}: {
  artifact: EditorArtifact;
  body: string;
  versions: ArtifactVersion[];
  visibilityOptions: VisibilityOptions;
  /** True when the target note already exists, so its own visibility governs. */
  visibilityLocked?: boolean;
  targetFolders: string[];
  canPublish: boolean;
  canPublishDirect: boolean;
  /** RICH_EDITOR_ENABLED, resolved on the server. Off keeps the edit/preview pair. */
  richEditorEnabled?: boolean;
}) {
  const terms = useChangeRequestTerms();
  const router = useRouter();
  const [title, setTitle] = useState(artifact.title);
  const [body, setBody] = useState(initialBody);
  // Prefill an editable suggestion when no target is set yet, so the owner gets
  // a sensible `notes/<slug>.md` placement to accept or change rather than a
  // blank field. A saved target always wins.
  const [targetPath, setTargetPath] = useState(
    artifact.targetPath ?? suggestTargetPath(artifact.title, targetFolders[0]),
  );
  const [visibility, setVisibility] = useState((artifact.targetVisibility ?? ["all-hands"]).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Held separately from `notice` so the merge request can be rendered as a real
  // link. It used to be interpolated into the notice string, which left the
  // reviewer a bare URL to select and paste by hand. Seeded from the persisted
  // value, so reopening an artifact that is already in review still shows the
  // way to its own review.
  const [mrUrl, setMrUrl] = useState<string | null>(artifact.mrUrl);

  const published = artifact.status === "published";
  // An artifact behind an open merge request is frozen for the same reason a
  // published one is: its content has already been proposed at a fixed path, so
  // editing here would silently diverge from what reviewers are looking at.
  const locked = published || artifact.status === "in_review";
  const deleteNoun = artifact.status === "draft" ? "draft" : "artifact";

  async function patch(payload: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(messageForBody(await res.json().catch(() => null)));
        return;
      }
      setNotice(okMessage);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function publish(mode: "mr" | "direct") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Persist the CURRENTLY displayed title, target and visibility FIRST, so
      // what we publish is exactly what the owner sees, never a stale DB
      // destination or clearance (a real mis-clearance risk otherwise). Title is
      // included because omitting it meant a renamed artifact published and then
      // silently reverted: the path the owner typed was honoured while the title
      // they typed was not.
      //
      // `body` is deliberately NOT sent. The PATCH route appends a version
      // whenever a body is present, so including it minted a duplicate version
      // on every publish and another on every retry after a failure. The body is
      // already persisted by Save version.
      const saveTarget = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          targetPath: targetPath.trim(),
          targetVisibility: parseVisibility(visibility),
        }),
      });
      if (!saveTarget.ok) {
        setError(messageForBody(await saveTarget.json().catch(() => null)));
        return;
      }

      const res = await fetch(`/api/artifacts/${artifact.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as { mrUrl?: string };
      if (!res.ok) {
        setError(messageForBody(data));
        return;
      }
      setMrUrl(data.mrUrl ?? null);
      setNotice(data.mrUrl ? `${capitalizedTerm(terms)} opened for review.` : "Published.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(messageForBody(await res.json().catch(() => null)));
        return;
      }
      // Gone: leave the detail view for the list, which will no longer show it.
      router.push("/artifacts");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={title}
          disabled={locked || busy}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Artifact title"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold text-ink hover:border-line focus:border-line disabled:opacity-60"
        />
        <StatusPill status={artifact.status} />
      </header>

      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {notice ? (
        <p className="text-sm text-good">
          {notice}
          {mrUrl ? (
            <>
              {" "}
              <a href={mrUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                Open {terms.long}
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <ArtifactBody
        body={body}
        onChange={setBody}
        // The latest version's format. A designed page promoted from a chat
        // document arrives here as HTML, and the markdown renderer discards raw
        // HTML rather than printing it, so without this the artifact rendered as
        // an empty document.
        format={versions.at(-1)?.format ?? "md"}
        locked={locked}
        busy={busy}
        richEditorEnabled={richEditorEnabled}
      />
      {!locked ? (
        <div>
          <button
            type="button"
            onClick={() => patch({ title, body }, "Saved a new version.")}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Save version
          </button>
        </div>
      ) : null}

      <PublishPanel
        status={artifact.status}
        targetPath={targetPath}
        visibility={visibility}
        visibilityOptions={visibilityOptions}
        visibilityLocked={visibilityLocked}
        targetFolders={targetFolders}
        canPublish={canPublish}
        canPublishDirect={canPublishDirect}
        mrUrl={mrUrl}
        publishedNotePath={artifact.publishedNotePath}
        busy={busy}
        onTargetPathChange={setTargetPath}
        onVisibilityChange={setVisibility}
        onMarkReady={() =>
          patch(
            { targetPath: targetPath.trim(), targetVisibility: parseVisibility(visibility), status: "ready" },
            "Marked ready to publish.",
          )
        }
        onPublish={publish}
      />

      <VersionHistory versions={versions} />

      {/* Not deletable while in review: the row would go while the merge request
          and its branch stayed open, so an abandoned proposal could still be
          merged with no artifact left to explain it. The API refuses it too. */}
      {!locked ? <DeleteArtifact noun={deleteNoun} busy={busy} onDelete={remove} /> : null}
    </div>
  );
}
