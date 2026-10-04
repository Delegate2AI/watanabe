"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { HtmlDocument } from "@/components/ui/html-document";
import { cn } from "@/lib/utils";
import { useChatDoc } from "./use-chat-doc";
import { DownloadMenu } from "./download-menu";
import { PromoteControls } from "./promote-controls";

/**
 * The canvas preview pane (spec 29): chat left, this pane right. Header carries
 * the title, a Rendered / Markdown toggle, Promote (Artifact / Shared File),
 * Copy, Download, and Close; the body renders the selected version through the
 * spec-25 markdown renderer (or raw markdown when toggled), with a version
 * selector when more than one version exists (latest by default).
 *
 * Client-safe: it imports only the client `Markdown` renderer, the client
 * Button, and the local hook/controls. On md+ it is a drag-resizable side
 * column; below md it is a full-screen overlay toggled from the transcript card.
 */

const MIN_WIDTH = 320;
/**
 * The pane opens at half the window and drags to 70% of it, both relative
 * rather than fixed. It used to open at 480px against a fixed 760px ceiling,
 * which on any large display left the document in a narrow rail beside a chat
 * column that was mostly empty margin: the point of the canvas is to read the
 * document, so it gets an equal half of the room.
 */
const DEFAULT_FRACTION = 0.5;
const MAX_FRACTION = 0.7;

function widthBounds(windowWidth: number) {
  const max = Math.max(MIN_WIDTH, Math.round(windowWidth * MAX_FRACTION));
  return { max, initial: Math.min(max, Math.max(MIN_WIDTH, Math.round(windowWidth * DEFAULT_FRACTION))) };
}

export function CanvasPane({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { data, loading, error, reload } = useChatDoc(docId);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"rendered" | "markdown">("rendered");
  // `null` until mounted: measuring the window during render would differ from
  // the server pass, so the pre-mount width comes from the `md:w-1/2` class.
  const [width, setWidth] = useState<number | null>(null);
  const draggingRef = useRef(false);

  // Below md the pane is a full-screen overlay (`fixed inset-0`), and an inline
  // width there would pin it to the left edge at that width instead. So the
  // width only exists on md+, and a resize re-clamps it rather than leaving a
  // dragged pane wider than the window it now sits in.
  useEffect(() => {
    function sync() {
      if (window.innerWidth < 768) {
        setWidth(null);
        return;
      }
      const { max, initial } = widthBounds(window.innerWidth);
      setWidth((current) => Math.min(current ?? initial, max));
    }
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // The listeners are created and torn down together inside one closure (function
  // declarations, so `up` can reference itself without a temporal-dead-zone or a
  // self-referential useCallback the hooks linter rejects). The pane sits on the
  // right, so its width grows as the pointer moves left.
  const startDrag = useCallback(() => {
    draggingRef.current = true;
    function move(e: PointerEvent) {
      if (!draggingRef.current) return;
      const next = window.innerWidth - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(widthBounds(window.innerWidth).max, next)));
    }
    function up() {
      draggingRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const versions = data?.versions ?? [];
  const latestVersion = versions.length > 0 ? versions[versions.length - 1].version : 1;
  const activeVersion = selected ?? latestVersion;
  const active = versions.find((v) => v.version === activeVersion);
  const body = active?.body ?? "";
  // Per VERSION, not per document: a document rewritten as a designed page keeps
  // markdown history, and each version has to render as what it actually was.
  const isHtml = active?.format === "html";

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(body).catch(() => {});
  }, [body]);


  return (
    <aside
      className={cn(
        "fixed inset-0 z-40 flex flex-col border-line bg-surface",
        "md:static md:inset-auto md:z-auto md:w-1/2 md:border-l",
      )}
      style={width === null ? undefined : { width }}
      aria-label="Document canvas"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDrag}
        className="absolute left-0 top-0 hidden h-full w-1 cursor-col-resize hover:bg-accent/40 md:block"
      />
      {/* `md:pt-14` clears the shell's floating identity cluster (absolute,
          right-4 top-3, z-10 in MainFrame), which otherwise lands on top of
          this row and hides the view toggle and the window controls. The chat
          column reserves the same offset for the same reason. Below md the
          pane is a z-40 overlay above the cluster, so it needs nothing. */}
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 md:pt-14">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{data?.doc.title ?? "Document"}</h2>
        <div className="flex items-center rounded-control border border-line text-xs">
          <button
            type="button"
            onClick={() => setView("rendered")}
            className={cn("px-2 py-1", view === "rendered" ? "bg-surface-2 text-ink" : "text-ink-muted")}
          >
            Rendered
          </button>
          <button
            type="button"
            onClick={() => setView("markdown")}
            className={cn("px-2 py-1", view === "markdown" ? "bg-surface-2 text-ink" : "text-ink-muted")}
          >
            {/* The source view shows the body verbatim either way, so the label
                names what the reader would actually see rather than always
                claiming markdown. */}
            {isHtml ? "Source" : "Markdown"}
          </button>
        </div>
        <Button size="icon" variant="ghost" aria-label="Copy" onClick={copy}>
          <Copy className="size-4" />
        </Button>
        <DownloadMenu docId={docId} version={activeVersion} />
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      {data && (
        <div className="border-b border-line px-4 py-3">
          <PromoteControls docId={docId} data={data} onChanged={reload} />
        </div>
      )}

      {versions.length > 1 && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-ink-muted">
          <label htmlFor="canvas-version">Version</label>
          <select
            id="canvas-version"
            className="rounded-control border border-line bg-surface px-2 py-1"
            value={activeVersion}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.version === latestVersion ? " (latest)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* A designed page brings its own margins and full-bleed sections, so the
          frame gets the whole pane rather than sitting inside the prose gutter
          that markdown wants. */}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", isHtml && view === "rendered" ? "" : "px-6 py-5")}>
        {loading && !data ? (
          <p className="px-6 py-5 text-sm text-ink-faint">Loading…</p>
        ) : error ? (
          <p className="px-6 py-5 text-sm text-ink-faint">{error}</p>
        ) : view === "markdown" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] text-ink">{body}</pre>
        ) : isHtml ? (
          <HtmlDocument html={body} title={data?.doc.title ?? "Document"} />
        ) : (
          <Markdown>{body}</Markdown>
        )}
      </div>
    </aside>
  );
}
