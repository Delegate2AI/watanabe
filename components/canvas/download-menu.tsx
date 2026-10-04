"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Download a document as PDF, HTML or Markdown
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Links to the export route rather than building a `Blob` here. The previous
 * control did the latter, which is why the only format the portal has ever
 * offered is `.md`: a PDF and a self-contained HTML with its fonts inlined and
 * its diagrams drawn cannot be assembled in the browser. The route also renders
 * on demand when the debounced save-time render has not landed yet.
 */

const FORMATS = [
  { kind: "pdf", label: "PDF", hint: "Document" },
  { kind: "html", label: "Web page", hint: "Self-contained HTML" },
  { kind: "md", label: "Markdown", hint: "Plain text" },
] as const;

export function DownloadMenu({ docId, version }: { docId: string; version?: number }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A plain popover rather than the radix
  // dropdown the rest of the shell uses: the items are links, not commands, so
  // the browser's own download behaviour is what should handle activation.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={container}>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Download"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Download className="size-4" />
      </Button>
      {/* A list of links, not a `role="menu"`. These navigate rather than
          command, and an explicit `menuitem` role would override the implicit
          link role, taking the download affordance (open in a new tab, copy the
          address) away from anyone using a screen reader. */}
      {open && (
        <div
          aria-label="Download format"
          className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-control border border-line bg-surface shadow-lg"
        >
          {FORMATS.map((format) => (
            <a
              key={format.kind}
              // `encodeURIComponent`, not template interpolation: an id is data,
              // and a slash in one would otherwise change which route is hit.
              //
              // The version travels too. Without it the route always served the
              // LATEST, so reading an older version and pressing Download handed
              // over a different document than the one on screen.
              href={
                `/api/chat-docs/${encodeURIComponent(docId)}/export/${format.kind}` +
                (version ? `?v=${version}` : "")
              }
              download
              onClick={() => setOpen(false)}
              className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm text-ink hover:bg-surface-2"
            >
              <span>{format.label}</span>
              <span className="text-xs text-ink-faint">{format.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
