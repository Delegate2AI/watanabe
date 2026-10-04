"use client";

import { useState } from "react";
import { PersonChip, personFor } from "@/components/person-chip";
import { messageForBody } from "@/lib/errors/messages";
import type { Person } from "@/lib/people/types";
import type { DocAccessRequest, SharedAccess } from "@/lib/shared-docs/types";

const LEVEL_LABEL: Record<SharedAccess, string> = {
  view: "Viewer",
  comment: "Commenter",
  edit: "Editor",
};

/**
 * The owner's queue of people asking for access to this document.
 *
 * Rendered by the page only for the owner and only when something is pending,
 * so it is absent from a document nobody has asked about. The route re-checks
 * ownership on every decision.
 *
 * Granting at a level other than the one asked for is a first-class action, not
 * a correction: the select carries the level, and Grant sends whatever it holds.
 */
export function AccessRequestsPanel({
  docId,
  initialRequests,
  people = {},
}: {
  docId: string;
  initialRequests: DocAccessRequest[];
  people?: Record<string, Person>;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [levels, setLevels] = useState<Record<string, SharedAccess>>(() =>
    Object.fromEntries(initialRequests.map((r) => [r.id, r.access])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(request: DocAccessRequest, decision: "granted" | "declined"): Promise<void> {
    setBusy(request.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/docs/${encodeURIComponent(docId)}/access-requests/${encodeURIComponent(request.id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, access: levels[request.id] ?? request.access }),
        },
      );
      if (!response.ok) {
        setError(messageForBody(await response.json().catch(() => ({}))));
        return;
      }
      setRequests((current) => current.filter((r) => r.id !== request.id));
    } catch {
      setError("The request could not be answered.");
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <section className="mb-5 rounded-chip border border-line bg-surface-2 p-4" aria-label="Access requests">
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {requests.length === 1 ? "1 person is asking for access" : `${requests.length} people are asking for access`}
      </h2>
      <ul className="space-y-3">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <PersonChip person={personFor(people, request.requesterEmail)} variant="avatar" className="min-w-40 flex-1" />
            <label className="sr-only" htmlFor={`level-${request.id}`}>
              Access to grant
            </label>
            <select
              id={`level-${request.id}`}
              value={levels[request.id] ?? request.access}
              disabled={busy !== null}
              onChange={(e) =>
                setLevels((current) => ({ ...current, [request.id]: e.target.value as SharedAccess }))}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
            >
              {(Object.keys(LEVEL_LABEL) as SharedAccess[]).map((level) => (
                <option key={level} value={level}>{LEVEL_LABEL[level]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void decide(request, "granted")}
              disabled={busy !== null}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              Grant
            </button>
            <button
              type="button"
              onClick={() => void decide(request, "declined")}
              disabled={busy !== null}
              className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink-muted hover:bg-surface-hover disabled:opacity-60"
            >
              Decline
            </button>
            {request.message ? (
              <p className="basis-full text-xs text-ink-muted">{request.message}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
