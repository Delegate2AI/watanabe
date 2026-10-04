"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/ui/date";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import type { DocLink, LinkAccess } from "@/lib/shared-docs/types";

const ACCESS_LABEL: Record<LinkAccess, string> = { view: "Can view", comment: "Can comment" };

/** The path the app actually serves an external link on. */
export function linkPath(token: string): string {
  return `/docs/shared/${token}`;
}

function isExpired(link: DocLink, now: Date): boolean {
  return link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now.getTime();
}

/**
 * Active links first, then expired ones, each group oldest first. An expired
 * link is still shown (it is a thing the owner minted and may want to clear)
 * but it must never sit above a link that still works.
 */
function ordered(links: DocLink[], now: Date): DocLink[] {
  return [...links].sort((a, b) => {
    const dead = Number(isExpired(a, now)) - Number(isExpired(b, now));
    return dead !== 0 ? dead : a.createdAt.localeCompare(b.createdAt);
  });
}

/** The page origin never changes within a document, so nothing to subscribe to. */
const subscribeToOrigin = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notifySuccess("Link copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied outright. Say so rather than silently
      // doing nothing: the person still has the visible URL to select by hand.
      notifyFailure("Could not copy the link. Select it and copy by hand.");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy link ${url}`}
      className="shrink-0 text-ink-muted hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/**
 * The external-links section of the share manager (spec 28, surface-polish
 * P-10): mint and revoke signed, unauthenticated links (view|comment only).
 *
 * A link used to render as the bare text `/docs/shared/<token> (view)`: no
 * origin, not clickable, nothing to copy, and no way to tell a live link from a
 * dead one. It now renders the absolute URL, with a copy button, when it was
 * created, when it expires, and what it grants.
 */
export function ExternalLinks({ id, initialLinks }: { id: string; initialLinks: DocLink[] }) {
  const [links, setLinks] = useState(initialLinks);
  const [linkAccess, setLinkAccess] = useState<LinkAccess>("view");
  const [busy, setBusy] = useState(false);
  // The origin is only knowable in the browser. Read as an external store so a
  // server render and the first client render agree (the server snapshot is the
  // empty string, leaving the path, which is still a working relative link).
  const origin = useSyncExternalStore(subscribeToOrigin, clientOrigin, serverOrigin);
  const now = new Date();

  async function refreshLinks() {
    const res = await fetch(`/api/docs/${id}/links`);
    if (res.ok) setLinks(((await res.json()) as { links: DocLink[] }).links);
  }
  async function mintLink() {
    setBusy(true);
    try {
      await fetch(`/api/docs/${id}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access: linkAccess }),
      });
      await refreshLinks();
    } finally {
      setBusy(false);
    }
  }
  async function revokeLink(token: string) {
    await fetch(`/api/docs/${id}/links`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    await refreshLinks();
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-ink">External links</h2>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={linkAccess}
          onChange={(e) => setLinkAccess(e.target.value as LinkAccess)}
          aria-label="Access for new link"
          className="rounded-chip border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink"
        >
          <option value="view">Can view</option>
          <option value="comment">Can comment</option>
        </select>
        <button
          type="button"
          onClick={mintLink}
          disabled={busy}
          className="rounded-chip border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink disabled:opacity-60"
        >
          Create link
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered(links, now).map((l) => {
          const expired = isExpired(l, now);
          const url = `${origin}${linkPath(l.token)}`;
          return (
            <li key={l.token} className={`text-sm ${expired ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                <a
                  href={linkPath(l.token)}
                  className="min-w-0 flex-1 truncate font-mono text-xs text-accent-ink hover:underline"
                  title={url}
                >
                  {url}
                </a>
                <CopyButton url={url} />
                <button
                  type="button"
                  onClick={() => revokeLink(l.token)}
                  className="shrink-0 text-xs text-ink-muted hover:text-warn"
                >
                  Revoke
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span>{ACCESS_LABEL[l.access]}</span>
                <span aria-hidden>&middot;</span>
                <span title={formatDateTime(l.createdAt)}>Created {formatDate(l.createdAt)}</span>
                <span aria-hidden>&middot;</span>
                {l.expiresAt === null ? (
                  <span>No expiry</span>
                ) : expired ? (
                  <span className="font-medium text-warn" title={formatDateTime(l.expiresAt)}>
                    Expired {formatDate(l.expiresAt)}
                  </span>
                ) : (
                  <span title={formatDateTime(l.expiresAt)}>Expires {formatDate(l.expiresAt)}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
