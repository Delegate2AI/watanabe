"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { personFor } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import { codeFromBody, messageFor } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import type { ProjectDocument } from "@/lib/db/project-docs";
import { ProjectDocumentRow } from "./project-document-row";

/** Mirrors the server-side allow list, so the picker offers only what will land. */
const ACCEPT = ".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif";

/**
 * Project documents (spec 26 extension, surface-polish P-04): upload files into
 * a project, open what is there, and remove them. All calls go through the
 * project-scoped API, which authorizes by project visibility; this component
 * drives it and keeps an optimistic local list.
 *
 * `people` is resolved server-side and passed down, because `<PersonChip>` takes
 * an already-resolved person: the resolver reaches `node:fs`, which a client
 * module may not import. An address the map does not carry (a row this component
 * just added) degrades to the address itself.
 */
export function ProjectDocuments({
  projectId,
  initialDocuments,
  people = {},
}: {
  projectId: string;
  initialDocuments: ProjectDocument[];
  people?: Record<string, Person>;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as { document?: ProjectDocument } | null;
      if (!res.ok || !data?.document) {
        notifyFailure(messageFor(codeFromBody(data)));
        return;
      }
      setDocuments((prev) => [data.document!, ...prev]);
      notifySuccess(`Uploaded ${data.document.filename}.`);
    } catch {
      notifyFailure(messageFor(undefined));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(documentId: string) {
    setRemovingId(documentId);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        notifyFailure(messageFor(codeFromBody(await res.json().catch(() => null))));
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
      // No undo: removing a document deletes its bytes, so there is nothing a
      // single reversing call could restore.
      notifySuccess("Document removed.");
    } catch {
      notifyFailure(messageFor(undefined));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Upload a document"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50"
      >
        <Upload className="size-4" aria-hidden />
        {busy ? "Uploading..." : "Upload document"}
      </button>

      {documents.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No documents uploaded yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {documents.map((doc) => (
            <ProjectDocumentRow
              key={doc.id}
              projectId={projectId}
              doc={doc}
              uploader={personFor(people, doc.uploaderEmail.trim().toLowerCase())}
              onRemove={remove}
              removing={removingId === doc.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
