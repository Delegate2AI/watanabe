"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CanvasDocData, PromotionView } from "./use-chat-doc";

/**
 * Promote + Update controls for the canvas pane (spec 29). Promote seeds an
 * Artifact (spec 27) or Shared File (spec 28) from the current version and then
 * NAVIGATES to that target's management surface (the spec-27 publish side sheet
 * / the spec-28 share manager), which is what the spec requires on a successful
 * promotion. Update pushes a later chat version as a new target version, but only
 * when the chat doc is ahead, and behind an explicit confirm when the target
 * diverged (it was edited independently since the promotion). A target whose flag
 * is off is hidden entirely; with both off the pane still previews/copies/downloads.
 *
 * Client-safe: types come in via `import type`; there is no server value here.
 */

const LABELS: Record<PromotionView["targetType"], { label: string; noun: string; hrefBase: string }> = {
  artifact: { label: "Artifact", noun: "Artifact", hrefBase: "/artifacts" },
  shared_doc: { label: "Shared File", noun: "Shared File", hrefBase: "/docs" },
};

type Target = PromotionView["targetType"];

export function PromoteControls({
  docId,
  data,
  onChanged,
}: {
  docId: string;
  data: CanvasDocData;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Target | null>(null);
  const [divergedTarget, setDivergedTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const promoted = (t: Target) => data.promotions.find((p) => p.targetType === t) ?? null;
  const enabled = (t: Target) => (t === "artifact" ? data.flags.artifactsEnabled : data.flags.sharedDocsEnabled);

  async function promote(target: Target) {
    setBusy(target);
    setMessage(null);
    try {
      const res = await fetch(`/api/chat-docs/${encodeURIComponent(docId)}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        setMessage(`Could not promote to ${LABELS[target].noun}.`);
        return;
      }
      onChanged();
      // Open the target's management surface (spec-27 publish / spec-28 share).
      const body = (await res.json().catch(() => null)) as { targetId?: string } | null;
      if (body?.targetId) router.push(`${LABELS[target].hrefBase}/${body.targetId}`);
    } finally {
      setBusy(null);
    }
  }

  async function update(target: Target, confirm: boolean) {
    setBusy(target);
    setMessage(null);
    try {
      const res = await fetch(`/api/chat-docs/${encodeURIComponent(docId)}/update-target`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, confirm }),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { error?: { detail?: string } } | null;
        if (body?.error?.detail === "diverged") {
          setDivergedTarget(target);
          return;
        }
        setMessage("Nothing new to update.");
        return;
      }
      if (!res.ok) {
        setMessage(`Could not update the ${LABELS[target].noun}.`);
        return;
      }
      setDivergedTarget(null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const targets = (["artifact", "shared_doc"] as Target[]).filter(enabled);
  if (targets.length === 0) {
    return <p className="text-xs text-ink-faint">Promotion targets are turned off.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((target) => {
          const p = promoted(target);
          const meta = LABELS[target];
          if (!p) {
            return (
              <Button key={target} size="sm" variant="outline" disabled={busy !== null} onClick={() => promote(target)}>
                Promote to {meta.label}
              </Button>
            );
          }
          const canUpdate = p.classification.status !== "up_to_date";
          return (
            <span key={target} className="inline-flex items-center gap-2 text-xs text-ink-muted">
              {meta.noun} at v{p.targetCurrentVersion}
              <a className="text-accent underline-offset-2 hover:underline" href={`${meta.hrefBase}/${p.targetId}`}>
                Open
              </a>
              {canUpdate && (
                <Button size="sm" variant="subtle" disabled={busy !== null} onClick={() => update(target, false)}>
                  Update {meta.label}
                </Button>
              )}
            </span>
          );
        })}
      </div>
      {divergedTarget && (
        <DivergenceConfirm
          view={promoted(divergedTarget)!}
          noun={LABELS[divergedTarget].noun}
          busy={busy !== null}
          onConfirm={() => update(divergedTarget, true)}
          onCancel={() => setDivergedTarget(null)}
        />
      )}
      {message && <p className="text-xs text-ink-faint">{message}</p>}
    </div>
  );
}

function DivergenceConfirm({
  view,
  noun,
  busy,
  onConfirm,
  onCancel,
}: {
  view: PromotionView;
  noun: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-control border border-line bg-surface-2 p-3 text-xs text-ink">
      <p>
        This {noun} was edited since you promoted it (now at v{view.targetCurrentVersion}, you promoted v
        {view.promotedVersion}). Updating adds your chat version as v{view.classification.projectedTargetVersion}; the
        versions in between stay in history.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="default" disabled={busy} onClick={onConfirm}>
          Update anyway
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
