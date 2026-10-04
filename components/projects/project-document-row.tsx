"use client";

import { useState } from "react";
import { Download, Eye, FileText, X } from "lucide-react";
import { PersonChip } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import type { ProjectDocument } from "@/lib/db/project-docs";

/** Types the preview panel can render in place. Everything else downloads. */
const PREVIEWABLE = new Set(["text/plain", "text/markdown"]);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentHref(projectId: string, docId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`;
}

/**
 * One project document row (surface-polish P-04). Before this the filename was
 * a `<span>` and the only control was Remove, so an uploaded file could be seen
 * but never opened, and nothing said who put it there or when.
 *
 * The filename is now a link to the clearance-scoped download route. Text and
 * markdown additionally get an inline preview so a short note does not have to
 * land in the Downloads folder to be read.
 */
export function ProjectDocumentRow({
  projectId,
  doc,
  uploader,
  onRemove,
  removing = false,
}: {
  projectId: string;
  doc: ProjectDocument;
  uploader: Person;
  onRemove: (documentId: string) => void;
  removing?: boolean;
}) {
  const href = documentHref(projectId, doc.id);
  const canPreview = PREVIEWABLE.has(doc.contentType);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function togglePreview() {
    if (preview !== null) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(href);
      // A failed preview says so in the panel rather than raising a toast: the
      // person asked to look at one file, not to change anything.
      setPreview(res.ok ? await res.text() : "This document could not be previewed.");
    } catch {
      setPreview("This document could not be previewed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <FileText className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <a href={href} className="truncate font-medium text-ink hover:text-accent hover:underline">
            {doc.filename}
          </a>
          <span className="shrink-0 text-xs text-ink-muted">{formatBytes(doc.byteSize)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {canPreview ? (
            <button
              type="button"
              onClick={togglePreview}
              aria-label={`Preview ${doc.filename}`}
              aria-expanded={preview !== null}
              className="text-ink-muted hover:text-ink"
            >
              <Eye className="size-4" aria-hidden />
            </button>
          ) : (
            <a href={href} download aria-label={`Download ${doc.filename}`} className="text-ink-muted hover:text-ink">
              <Download className="size-4" aria-hidden />
            </a>
          )}
          <button
            type="button"
            onClick={() => onRemove(doc.id)}
            disabled={removing}
            aria-label={`Remove ${doc.filename}`}
            className="text-ink-muted hover:text-warn disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-ink-muted">
        <PersonChip person={uploader} />
        <span aria-hidden>&middot;</span>
        <time dateTime={doc.createdAt} title={formatDateTime(doc.createdAt)}>
          {formatRelative(doc.createdAt)}
        </time>
      </div>
      {loading ? <p className="mt-2 pl-6 text-xs text-ink-muted">Loading preview...</p> : null}
      {preview !== null ? (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 text-xs text-ink">
          {preview}
        </pre>
      ) : null}
    </li>
  );
}
