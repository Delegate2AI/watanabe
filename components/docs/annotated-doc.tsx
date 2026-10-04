"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/ui/markdown";
import type { CommentThread, Suggestion, TextAnchor } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";
import { plainTextOf, offsetsFromSelection } from "@/lib/shared-docs/rendered-text";
import { createAnchor, locateInSource } from "@/lib/shared-docs/anchor";
import { useDocHighlights, type HighlightItem } from "./use-doc-highlights";
import { useDocAnnotations } from "./use-doc-annotations";
import { SelectionBubble } from "./selection-bubble";
import { DocEditor } from "./doc-editor";
import { DocToolbar, type DocMode } from "./doc-toolbar";
import { ReviewRail } from "./review-rail";
import { CopilotPanel } from "./copilot-panel";
import { cn } from "@/lib/utils";

interface DocAccess {
  canComment: boolean;
  canEdit: boolean;
}

type Composer = { kind: "comment"; anchor: TextAnchor | null } | { kind: "suggest"; anchor: TextAnchor };

/**
 * Orchestrates the annotated reading surface (spec 2026-07-22): the toolbar mode
 * control, the paper-styled body, the selection bubble, highlight registration,
 * the comment/suggest composers, and the gutter of threads plus suggestion
 * cards. Thread and suggestion state, the poll, and every fetch handler live in
 * `useDocAnnotations`; this component stays the presentational shell.
 *
 * The three modes map onto the pre-existing state rather than adding behaviour
 * (redesign 2026-07-22): Suggesting is the annotate surface (`!preview`),
 * Viewing is the preview splice (`preview`), and Editing swaps the body for the
 * existing `DocEditor`, reused as-is so there is never a rendered copy of the
 * body plus a second editable copy at once. Saving or cancelling returns here.
 */
export function AnnotatedDoc({
  doc, access, initialThreads, initialSuggestions, people = {}, richEditorEnabled = false,
  copilotEnabled = false, docTitle = "", copilotThreadId = null,
}: {
  doc: { id: string; body: string };
  access: DocAccess;
  initialThreads: CommentThread[];
  initialSuggestions: Suggestion[];
  /**
   * Comment and suggestion authors, resolved server-side. `<PersonChip>` takes
   * an already-resolved person, and an annotation created in this session
   * degrades to its raw address until the next server render.
   */
  people?: Record<string, Person>;
  /** RICH_EDITOR_ENABLED, resolved on the server and handed to `DocEditor`. */
  richEditorEnabled?: boolean;
  /** Doc copilot (spec 2026-08-27): flag + comment tier, resolved on the server. */
  copilotEnabled?: boolean;
  docTitle?: string;
  /** The viewer's newest copilot thread on this doc, resolved on the server. */
  copilotThreadId?: string | null;
}) {
  const router = useRouter();
  const { threads, suggestions, error, refresh, submitComment, submitSuggestion, onReply, onResolve, onAccept, onReject } =
    useDocAnnotations(doc.id, initialThreads, initialSuggestions);
  const [railTab, setRailTab] = useState<"review" | "copilot">("review");
  const [copilotQuote, setCopilotQuote] = useState<string | null>(null);

  const bodyRef = useRef<HTMLElement | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number; anchor: TextAnchor } | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [draft, setDraft] = useState("");
  const [proposed, setProposed] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [editingDoc, setEditingDoc] = useState(false);

  const mode: DocMode = editingDoc ? "edit" : preview ? "view" : "suggest";
  const pendingCount = suggestions.filter((s) => s.status === "pending").length;

  const highlights: HighlightItem[] = [
    ...threads.filter((t) => t.status === "open").map((t) => ({ id: t.id, anchor: t.anchor, kind: "comment" as const })),
    ...suggestions.filter((s) => s.status === "pending").map((s) => ({ id: s.id, anchor: s.anchor, kind: "suggestion" as const })),
  ];
  useDocHighlights(bodyRef, highlights);

  // Preview-only body: splice every pending suggestion into doc.body for DISPLAY,
  // highest source offset first so earlier offsets stay valid. Never persisted.
  const previewBody = useMemo(() => {
    if (!preview) return doc.body;
    const located = suggestions
      .filter((s) => s.status === "pending")
      .map((s) => ({ at: locateInSource(doc.body, s.anchor), text: s.proposedText }))
      .filter((x): x is { at: { start: number; end: number }; text: string } => x.at !== null)
      .sort((a, b) => b.at.start - a.at.start);
    let out = doc.body;
    for (const { at, text } of located) out = out.slice(0, at.start) + text + out.slice(at.end);
    return out;
  }, [preview, doc.body, suggestions]);

  // Selection-driven annotation is disabled while previewing a spliced body
  // (review fix #7): an anchor computed against the preview DOM would not
  // match the stored, unspliced body, orphaning a comment or misapplying a
  // suggestion the moment preview is turned back off.
  const onMouseUp = useCallback(() => {
    if (!access.canComment || preview) return;
    const root = bodyRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return setBubble(null);
    const offsets = offsetsFromSelection(root, sel);
    if (!offsets) return setBubble(null);
    const anchor = createAnchor(plainTextOf(root), offsets.start, offsets.end);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setBubble({ x: rect.left + rect.width / 2, y: rect.top - 4, anchor });
  }, [access.canComment, preview]);

  const setPreviewMode = useCallback((on: boolean) => {
    setPreview(on);
    if (on) {
      // A bubble/composer opened just before the toggle must not survive into
      // preview mode: it would still submit against the previewed, not the
      // stored, body.
      setBubble(null);
      setComposer(null);
    }
  }, []);

  function onMode(next: DocMode) {
    if (next === "edit") {
      setEditingDoc(true);
      return;
    }
    setEditingDoc(false);
    setPreviewMode(next === "view");
  }

  async function submit() {
    const body = draft.trim();
    if (!body || composer?.kind !== "comment") return;
    if (await submitComment(body, composer.anchor)) {
      setDraft("");
      setComposer(null);
    }
  }

  async function submitSuggest() {
    if (composer?.kind !== "suggest") return;
    // A deletion (empty replacement) is valid as long as the original
    // selection was non-empty (review fix #8); only block when both sides are
    // empty. `proposed` is sent verbatim, untrimmed, since leading/trailing
    // whitespace in a replacement can be an intentional part of the edit.
    if (composer.anchor.quote === "" && proposed === "") return;
    if (await submitSuggestion(composer.anchor, proposed, note)) {
      setProposed("");
      setNote("");
      setComposer(null);
    }
  }

  function handleDocSaved() {
    setEditingDoc(false);
    router.refresh(); // re-fetch the server-rendered body after the new version
  }

  return (
    <div className="flex flex-col gap-4">
      <DocToolbar
        mode={mode}
        canComment={access.canComment}
        canEdit={access.canEdit}
        onMode={onMode}
        onAddComment={() => {
          setComposer({ kind: "comment", anchor: null });
          setDraft("");
        }}
      />

      {editingDoc ? (
        <DocEditor
          id={doc.id}
          initialBody={doc.body}
          canEdit
          richEditorEnabled={richEditorEnabled}
          initialEditing
          onSaved={handleDocSaved}
          onCancel={() => setEditingDoc(false)}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-8">
          <article
            ref={bodyRef}
            onMouseUp={onMouseUp}
            className="rounded-card border border-line bg-surface px-6 py-8 shadow-elevated sm:px-10 sm:py-12"
          >
            <Markdown>{previewBody}</Markdown>
          </article>

          <aside className="mt-6 flex flex-col gap-3 lg:mt-0">
            {copilotEnabled && (
              <div role="tablist" aria-label="Document rail" className="inline-flex items-center gap-0.5 self-start rounded-control border border-line bg-surface-2 p-0.5">
                {(["review", "copilot"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={railTab === tab}
                    onClick={() => setRailTab(tab)}
                    className={cn(
                      "rounded-tab px-3 py-1 text-xs font-medium transition-colors",
                      railTab === tab ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {tab === "review" ? "Review" : "Copilot"}
                    {/* The badge keeps a copilot proposal visible while the chat tab is front. */}
                    {tab === "review" && pendingCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-ink">{pendingCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {copilotEnabled && railTab === "copilot" ? (
              <CopilotPanel
                docId={doc.id}
                docTitle={docTitle}
                initialThreadId={copilotThreadId}
                pendingQuote={copilotQuote}
                onQuoteConsumed={() => setCopilotQuote(null)}
                onSuggestFiled={refresh}
              />
            ) : (
              <ReviewRail
                error={error}
                preview={preview}
                composer={composer}
                draft={draft}
                onDraft={setDraft}
                proposed={proposed}
                onProposed={setProposed}
                note={note}
                onNote={setNote}
                onSubmitComment={submit}
                onSubmitSuggest={submitSuggest}
                onCancelComposer={() => setComposer(null)}
                threads={threads}
                suggestions={suggestions}
                canComment={access.canComment}
                canEdit={access.canEdit}
                people={people}
                onReply={onReply}
                onResolve={onResolve}
                onAccept={onAccept}
                onReject={onReject}
              />
            )}
          </aside>
        </div>
      )}

      {bubble && (
        <SelectionBubble
          x={bubble.x}
          y={bubble.y}
          onComment={() => {
            setComposer({ kind: "comment", anchor: bubble.anchor });
            setDraft("");
            setBubble(null);
            window.getSelection()?.removeAllRanges();
          }}
          onSuggest={
            access.canComment
              ? () => {
                  setComposer({ kind: "suggest", anchor: bubble.anchor });
                  setProposed("");
                  setNote("");
                  setBubble(null);
                  window.getSelection()?.removeAllRanges();
                }
              : null
          }
          onAskCopilot={
            copilotEnabled
              ? () => {
                  // The bubble's anchor already holds the rendered-plaintext
                  // quote; the server re-locates it in the markdown source.
                  setCopilotQuote(bubble.anchor.quote);
                  setRailTab("copilot");
                  setBubble(null);
                  window.getSelection()?.removeAllRanges();
                }
              : null
          }
        />
      )}
    </div>
  );
}
