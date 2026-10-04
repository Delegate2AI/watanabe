"use client";

import { useState } from "react";
import { Library } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { VisibilityChip } from "@/components/kit/visibility-chip";

/** The doc payload from `GET /api/kb/doc` (raw markdown body, rendered client-side). */
interface SourceDoc {
  path: string;
  title: string;
  visibility: "all-hands" | "restricted";
  group?: string;
  body: string;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; doc: SourceDoc }
  | { status: "error"; message: string };

/**
 * A KB citation shown under an assistant turn (spec 18): the source path and its
 * visibility. Clicking it opens an overlay modal that previews the cited
 * document inline, without leaving the chat. The document is fetched lazily on
 * open through `GET /api/kb/doc`, which reads the same clearance-scoped vault
 * root as the `/kb` page, so a card can never reveal a doc the requester is not
 * cleared for: the fetch simply 404s. Reused wherever the assistant grounds an
 * answer in a KB document.
 */
export function SourceCard({
  path,
  visibility,
  className,
}: {
  path: string;
  /**
   * The source doc's visibility label, e.g. "all-hands" or "exec", ONLY when the
   * tool result actually reported one. Undefined renders no label at all rather
   * than guessing: the card must not assert a clearance nobody told it, and the
   * dialog shows the real one from `GET /api/kb/doc`.
   */
  visibility?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/kb/doc?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        setState({
          status: "error",
          message:
            res.status === 404
              ? "This document is not available (it may be restricted or moved)."
              : "Could not load this document.",
        });
        return;
      }
      setState({ status: "ready", doc: (await res.json()) as SourceDoc });
    } catch {
      setState({ status: "error", message: "Could not load this document." });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Fetch once per open; re-opening a card that already loaded refetches for
    // freshness, which is cheap and keeps a moved/edited doc current.
    if (next) void load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn(
          "my-2.5 flex w-full items-center gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2 text-left text-xs",
          "transition-colors hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          className,
        )}
      >
        <Library className="size-[15px] shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 truncate">
          <b className="font-semibold text-ink">{path}</b>
          {visibility && <span className="text-ink-faint"> · visibility: {visibility}</span>}
        </span>
      </button>

      <DialogContent className="flex max-h-[80vh] w-[min(46rem,92vw)] max-w-none flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8">
            {state.status === "ready" ? state.doc.title : path}
          </DialogTitle>
          {state.status === "ready" && (
            <VisibilityChip visibility={state.doc.visibility} group={state.doc.group} />
          )}
        </DialogHeader>

        {/* min-h-0 lets this flex child shrink below its content height so its
            own overflow-y-auto engages instead of the content spilling past the
            capped dialog. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.status === "loading" && (
            <p className="text-sm text-ink-faint" aria-label="Loading">
              Loading…
            </p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-warn" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "ready" && <Markdown>{state.doc.body}</Markdown>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
