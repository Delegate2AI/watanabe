"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, Link2, Paperclip, Search, X } from "lucide-react";
import { codeFromBody, messageFor } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import type { ReferenceKind, ResolvedReference } from "@/lib/db/project-references";

export interface ReferenceCandidate {
  kind: ReferenceKind;
  targetId: string;
  title: string;
}

const KIND_LABEL: Record<ReferenceKind, string> = {
  artifact: "Artifact",
  shared_doc: "Shared doc",
  kb: "Knowledge base",
};

function KindIcon({ kind }: { kind: ReferenceKind }) {
  const className = "size-4 shrink-0 text-ink-faint";
  if (kind === "artifact") return <FileText className={className} aria-hidden />;
  if (kind === "kb") return <BookOpen className={className} aria-hidden />;
  return <Link2 className={className} aria-hidden />;
}

/**
 * Attach existing content to a project (surface-polish P-05). Before this the
 * only way in was "Upload document", while a project's own working context
 * named artifacts and shared docs that already existed in the app.
 *
 * An attachment is a REFERENCE, never a copy: the target keeps its owner and its
 * access rules, and the server re-resolves those on every read. So a reference
 * whose target is later revoked simply stops appearing here, with the row left
 * intact for when access comes back.
 *
 * Knowledge-base notes are searched rather than listed. The vault is far too
 * large to hand to the client as a candidate array, and it is the one target
 * type whose access is clearance-scoped, so the server answers `?q=` from the
 * caller's own projection and a note above their clearance simply has no hits.
 */
export function ProjectReferences({
  projectId,
  initialReferences,
  initialCandidates,
}: {
  projectId: string;
  initialReferences: ResolvedReference[];
  initialCandidates: ReferenceCandidate[];
}) {
  const [references, setReferences] = useState(initialReferences);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [kbCandidates, setKbCandidates] = useState<ReferenceCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const url = `/api/projects/${encodeURIComponent(projectId)}/references`;

  const attached = new Set(references.map((r) => `${r.kind}:${r.targetId}`));
  const available = initialCandidates.filter((c) => !attached.has(`${c.kind}:${c.targetId}`));
  const kbAvailable = kbCandidates.filter((c) => !attached.has(`${c.kind}:${c.targetId}`));

  async function searchDocs(term: string) {
    const trimmed = term.trim();
    if (!trimmed) {
      setKbCandidates([]);
      setSearched(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${url}?q=${encodeURIComponent(trimmed)}`);
      const data = (await res.json().catch(() => null)) as { kbCandidates?: ReferenceCandidate[] } | null;
      if (!res.ok || !data?.kbCandidates) {
        notifyFailure(messageFor(codeFromBody(data)));
        return;
      }
      setKbCandidates(data.kbCandidates);
      setSearched(true);
    } catch {
      notifyFailure(messageFor(undefined));
    } finally {
      setBusy(false);
    }
  }

  async function attach(candidate: ReferenceCandidate) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: candidate.kind, targetId: candidate.targetId }),
      });
      const data = (await res.json().catch(() => null)) as { references?: ResolvedReference[] } | null;
      if (!res.ok || !data?.references) {
        notifyFailure(messageFor(codeFromBody(data)));
        return;
      }
      setReferences(data.references);
      setPicking(false);
      notifySuccess(`Attached "${candidate.title}".`);
    } catch {
      notifyFailure(messageFor(undefined));
    } finally {
      setBusy(false);
    }
  }

  async function detach(reference: ResolvedReference) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenceId: reference.id }),
      });
      if (!res.ok) {
        notifyFailure(messageFor(codeFromBody(await res.json().catch(() => null))));
        return;
      }
      setReferences((prev) => prev.filter((r) => r.id !== reference.id));
      notifySuccess(`Detached "${reference.title}".`);
    } catch {
      notifyFailure(messageFor(undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setPicking((open) => !open)}
        aria-expanded={picking}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-50"
      >
        <Paperclip className="size-4" aria-hidden />
        Attach existing
      </button>

      {picking ? (
        <div className="mt-3 rounded-md border border-line bg-surface-2 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchDocs(query);
            }}
            className="mb-3 flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5"
          >
            <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the knowledge base"
              aria-label="Search the knowledge base"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </form>

          {searched ? (
            kbAvailable.length === 0 ? (
              <p className="mb-3 text-sm text-ink-muted">No knowledge-base notes match that.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1">
                {kbAvailable.map((c) => (
                  <li key={`${c.kind}:${c.targetId}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => attach(c)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface disabled:opacity-50"
                    >
                      <KindIcon kind={c.kind} />
                      <span className="truncate">{c.title}</span>
                      <span className="ml-auto shrink-0 truncate text-xs text-ink-muted">{c.targetId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {available.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing left to attach. Artifacts you own and documents shared with you show up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {available.map((c) => (
                <li key={`${c.kind}:${c.targetId}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => attach(c)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface disabled:opacity-50"
                  >
                    <KindIcon kind={c.kind} />
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-muted">{KIND_LABEL[c.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {references.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nothing referenced yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {references.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <KindIcon kind={r.kind} />
                <Link href={r.href} className="truncate font-medium text-ink hover:text-accent hover:underline">
                  {r.title}
                </Link>
                <span className="shrink-0 text-xs text-ink-muted">{KIND_LABEL[r.kind]}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => detach(r)}
                aria-label={`Detach ${r.title}`}
                className="shrink-0 text-ink-muted hover:text-warn disabled:opacity-50"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
