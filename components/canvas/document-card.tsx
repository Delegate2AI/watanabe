"use client";

import { DocCard } from "@/components/kit/doc-card";
import type { ChatDocRef } from "@/lib/canvas/derive";

/**
 * The compact card dropped into the transcript where `doc_write` was called
 * (spec 29): title, current version, and Open. It keeps the conversation
 * readable instead of inlining the whole document, and reopens the canvas pane.
 *
 * Client-safe: `ChatDocRef` is imported type-only, and the version label is
 * built from that plain data with no server module in the bundle.
 */
export function DocumentCard({ doc, onOpen }: { doc: ChatDocRef; onOpen: (docId: string) => void }) {
  const versionLabel = `Document · v${doc.version} · Open in canvas`;
  return (
    <div className="my-2 max-w-md">
      <DocCard title={doc.title} subtitle={versionLabel} onClick={() => onOpen(doc.docId)} />
    </div>
  );
}
