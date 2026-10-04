"use client";

import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";

/** A browser hint only. The route classifies the file again and decides. */
const ACCEPT = ".md,.markdown,.docx";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; name: string }
  | { kind: "error"; message: string }
  | { kind: "done"; id: string; title: string; droppedImages: number };

/** Whether a drag carries files at all, as opposed to selected text. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * The import surface: an Upload button in the header row beside the other page
 * actions, plus a page-level drop target around the shared-documents list. The
 * two share one upload path and one busy guard, which is why the button lives
 * here and not in its own island. `header` and `actions` are slots so the page
 * keeps the drop target off the header, where a dropped file could otherwise
 * land on the create button. One file at a time: a drop carrying several
 * imports the first and says so.
 */
export function DocDropZone({
  header,
  actions,
  children,
}: {
  header?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [extras, setExtras] = useState(0);
  // A second upload while one is in flight would create a document nobody asked
  // for and race the first for the redirect. State updates are async, so the
  // guard is a ref.
  const busy = useRef(false);

  async function upload(file: File, skipped = 0) {
    if (busy.current) return;
    busy.current = true;
    setStatus({ kind: "busy", name: file.name });
    setExtras(skipped);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/docs/import", { method: "POST", body });
      if (!res.ok) {
        setStatus({ kind: "error", message: messageForBody(await res.json().catch(() => null)) });
        return;
      }
      const doc = (await res.json()) as { id: string; title: string; droppedImages: number };
      // With nothing to report, go straight to the document. A note about
      // dropped images or skipped files would not survive the redirect, so
      // those cases wait for a click instead.
      if (doc.droppedImages === 0 && skipped === 0) {
        setStatus({ kind: "idle" });
        router.push(`/docs/${doc.id}`);
        router.refresh();
        return;
      }
      setStatus({ kind: "done", ...doc });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: messageForBody(null) });
    } finally {
      busy.current = false;
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    void upload(files[0], files.length - 1);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        {header}
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={status.kind === "busy"}
            title="Import a Markdown or Word file. You can also drop one on the list below."
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <Upload className="size-4" />
            Upload
          </button>
          {actions}
        </div>
      </div>

      <div
        // Both dragenter and dragover must be cancelled or the drop is refused.
        onDragEnter={(event) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (carriesFiles(event)) event.preventDefault();
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className="relative"
        data-testid="doc-drop-zone"
      >
        {status.kind === "busy" ? (
          <p className="mb-4 text-sm text-ink-muted" role="status">
            Importing {status.name}...
          </p>
        ) : null}

        {status.kind === "error" ? (
          <p className="mb-4 text-sm text-warn" role="alert">
            {status.message}
          </p>
        ) : null}

        {status.kind === "done" ? (
          <p className="mb-4 text-sm text-ink-muted" role="status">
            Imported{" "}
            <a href={`/docs/${status.id}`} className="font-medium text-accent hover:underline">
              {status.title}
            </a>
            .
            {status.droppedImages > 0
              ? ` ${status.droppedImages} ${status.droppedImages === 1 ? "image was" : "images were"} left out: this format keeps the words, not the pictures.`
              : null}
          </p>
        ) : null}

        {extras > 0 && status.kind !== "error" && status.kind !== "busy" ? (
          <p className="mb-4 text-sm text-ink-muted" role="status">
            Importing one file at a time. {extras} other {extras === 1 ? "file was" : "files were"} not imported.
          </p>
        ) : null}

        {children}

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-surface/80">
            <span className="text-sm font-medium text-ink">Drop to import a Markdown or Word file</span>
          </div>
        ) : null}
      </div>
    </>
  );
}
