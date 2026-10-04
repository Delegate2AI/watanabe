"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { useIdentity } from "@/components/identity-provider";
import { markSeedPending, recordSeedSession, seedDecisionFor } from "@/lib/chat/seed-guard";
import { announceThreadsChanged } from "@/lib/chat/threads-changed";
import { Composer } from "@/components/kit/composer";
import { labelForEffort, labelForModel, type ModelOption } from "@/lib/agent/model-options";
import type { ChatModelChoice } from "@/lib/chat/model-choice";
import type { AssistantTurn } from "@/lib/agent/conversation";
import { docsInTurn } from "@/lib/canvas/derive";
import { DocumentCard } from "@/components/canvas/document-card";
import { CanvasPane } from "@/components/canvas/canvas-pane";
import { ThreadSkeleton } from "@/components/skeletons/thread-skeleton";
import type { SaveState } from "./thread-turn";
import { TranscriptTurn, assistantText } from "./transcript-turn";
import { useChat } from "./use-chat";
import { useThreadScroll } from "./use-thread-scroll";

/**
 * A live chat thread surface (spec 24). Wires the spec-18 thread components to
 * the real runtime via `useChat`: turns stream in token by token, the sticky
 * in-thread Composer sends, and a KB-grounded answer renders its SourceCards.
 *
 * `initialQuery` (Home's `?q=` seed) marks this as a NEW thread: the route id is
 * a client handle, so the seed is sent once on mount and the first send starts
 * fresh. Without a seed this is a RESUME (the server already ownership-checked
 * the id). Every thread-scoped composer control receives the LIVE SDK id
 * (`activeId` from useChat), never the route placeholder, so a new chat's model
 * PATCH and attachment uploads target the real, owned thread. When the stream
 * reports that id, the URL is swapped in place (history.replaceState) so the
 * live stream is not torn down by a Next navigation. That swap moves the address
 * bar but NOT the history entry's router tree, so a seeded entry stays seeded
 * forever: see lib/chat/seed-guard.ts for how a restored entry is told apart
 * from a first render, and why it must be.
 */
export function Thread({
  id,
  initialQuery,
  initialConnector,
  attachmentsEnabled = false,
  preMinted = false,
  dictationEnabled = false,
  artifactsEnabled = false,
  canvasEnabled = false,
  models = [],
  modelSwitchingEnabled = false,
  initialChoice = {},
  connectorsEnabled = false,
}: {
  id: string;
  initialQuery?: string;
  initialConnector?: string;
  attachmentsEnabled?: boolean;
  preMinted?: boolean;
  dictationEnabled?: boolean;
  artifactsEnabled?: boolean;
  canvasEnabled?: boolean;
  models?: ModelOption[];
  modelSwitchingEnabled?: boolean;
  initialChoice?: ChatModelChoice;
  connectorsEnabled?: boolean;
}) {
  const { initials } = useIdentity();
  const router = useRouter();
  const isNew = Boolean(initialQuery);

  const onSession = useCallback(
    (sessionId: string) => {
      // Remember which real thread this client handle became, so a restored
      // history entry can resume it instead of seeding a second one.
      if (isNew) recordSeedSession(id, sessionId);
      if (typeof window !== "undefined" && sessionId !== window.location.pathname.split("/").pop()) {
        window.history.replaceState(null, "", `/chat/${sessionId}`);
      }
      // The thread row exists as of this event, but nothing re-rendered the
      // shell that lists it. Nudge the sidebar to refetch, so a new chat shows
      // up in Recents without a page reload.
      if (isNew) announceThreadsChanged();
    },
    [id, isNew],
  );

  const [choice, setChoice] = useState<ChatModelChoice>(initialChoice);
  const modelChoice = useMemo(() => (isNew ? choice : undefined), [isNew, choice]);

  const { turns, send, interrupt, status, hydrating, activeId, activeDoc, threadDocs } = useChat(
    id,
    { isNew, preMinted, onSession, canvasEnabled, modelChoice, pendingConnectors: initialConnector ? [initialConnector] : undefined },
  );

  // Stick-to-bottom transcript follow (parity with the KB chat's
  // use-chat-scroll): streams re-pin the view unless the user scrolled away.
  const { scrollRef, bottomRef, handleScroll, showJumpToBottom, scrollToBottom, pinToBottom } =
    useThreadScroll(turns);

  // Spec 29 canvas: the pane opens on the doc_write tool event. `activeDoc` is
  // the most recent doc_write across the transcript; when it changes to a new
  // document, auto-open it. The open is deferred to a timer (not a synchronous
  // effect setState) so it stays an async update. `openDoc` is the doc currently
  // shown in the pane; the transcript card reopens it, Close clears it.
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const lastAutoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!canvasEnabled || !activeDoc || activeDoc === lastAutoOpened.current) return;
    lastAutoOpened.current = activeDoc;
    const t = setTimeout(() => setOpenDoc(activeDoc), 0);
    return () => clearTimeout(t);
  }, [canvasEnabled, activeDoc]);

  // Per-turn save lifecycle for the "Save as artifact" affordance, so the button
  // can confirm success (and link to the artifact) or offer a retry, instead of
  // the old silent fire-and-forget.
  const [saveStates, setSaveStates] = useState<Record<string, { state: SaveState; href?: string }>>(
    {},
  );

  // Capture an assistant turn as a draft artifact (spec 27), linked to the LIVE
  // SDK thread id (the one the capture API ownership-checks), never the route
  // placeholder. A failed save surfaces a retry rather than disrupting the chat.
  const saveAsArtifact = useCallback(
    async (turn: AssistantTurn) => {
      const body = assistantText(turn);
      if (!body) return;
      setSaveStates((prev) => ({ ...prev, [turn.id]: { state: "saving" } }));
      try {
        const res = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, sourceThreadId: activeId ?? undefined }),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
        const { id: artifactId } = (await res.json()) as { id: string };
        setSaveStates((prev) => ({
          ...prev,
          [turn.id]: { state: "saved", href: `/artifacts/${artifactId}` },
        }));
      } catch {
        setSaveStates((prev) => ({ ...prev, [turn.id]: { state: "error" } }));
      }
    },
    [activeId],
  );

  // Fire the seed message exactly once, after mount (never twice under Strict
  // Mode's double-invoke), so Home's first question streams immediately.
  //
  // `seededRef` alone only covers THIS component instance. Back/forward gives
  // us a brand-new instance of the very same seeded page, because the history
  // entry keeps its `?q=` router tree even after the URL is swapped, so the ref
  // was false again and the seed minted another thread. `seedDecisionFor`
  // survives that: it reads the address bar and a per-tab marker to tell a
  // first render apart from a restored one. See lib/chat/seed-guard.ts.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !initialQuery) return;
    seededRef.current = true;
    const decision = seedDecisionFor(id, window.location.pathname);
    if (decision.action === "resume") {
      // A real navigation (not a replaceState): this remount has no live stream
      // to tear down, and the resume route hydrates the actual transcript.
      router.replace(`/chat/${decision.sessionId}`);
      return;
    }
    if (decision.action === "skip") return;
    markSeedPending(id);
    void send(initialQuery);
  }, [id, initialQuery, router, send]);

  const empty = turns.length === 0;

  // Hydrated cards (resume): show a card for any thread document NOT already
  // surfaced by a transcript doc_write segment, so a reloaded chat keeps every
  // document reopenable even if its tool result was compacted out of history.
  const transcriptDocIds = new Set<string>();
  for (const turn of turns) {
    if (turn.role === "assistant") for (const d of docsInTurn(turn)) transcriptDocIds.add(d.docId);
  }
  const hydratedDocs = canvasEnabled ? threadDocs.filter((d) => !transcriptDocIds.has(d.id)) : [];

  const chatColumn = (
    <div className="relative flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-8 pb-10 pt-14"
      >
        {hydratedDocs.length > 0 && (
          <div className="mb-4">
            {hydratedDocs.map((d) => (
              <DocumentCard
                key={d.id}
                doc={{ docId: d.id, version: d.currentVersion, title: d.title }}
                onOpen={setOpenDoc}
              />
            ))}
          </div>
        )}
        {hydrating ? (
          // Loading, not empty. The sentence below is a claim that this thread
          // has no messages, and the app may not make that claim until the
          // transcript has arrived.
          <ThreadSkeleton />
        ) : empty ? (
          <p className="pt-10 text-center text-ink-faint">
            Ask Watanabe anything about the knowledge base.
          </p>
        ) : (
          turns.map((turn) => (
            <TranscriptTurn
              key={turn.id}
              turn={turn}
              initials={initials}
              artifactsEnabled={artifactsEnabled}
              canvasEnabled={canvasEnabled}
              saveState={saveStates[turn.id]?.state}
              savedHref={saveStates[turn.id]?.href}
              onSave={saveAsArtifact}
              onOpenDoc={setOpenDoc}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {showJumpToBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted shadow-elevated transition-colors hover:text-ink"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            Jump to latest
          </button>
        </div>
      )}
      <div className="sticky bottom-0 bg-gradient-to-t from-bg from-[22%] to-transparent px-8 pb-6 pt-3">
        <Composer
          placeholder="Reply to Watanabe"
          showMic={dictationEnabled}
          dictationEnabled={dictationEnabled}
          className="mx-auto max-w-3xl"
          threadId={activeId ?? undefined}
          attachmentsEnabled={attachmentsEnabled}
          models={models}
          modelSwitchingEnabled={modelSwitchingEnabled}
          model={labelForModel(models, choice.model)}
          level={labelForEffort(choice.effort)}
          onModelChange={(next) => setChoice((prev) => ({ ...prev, ...next }))}
          connectorsEnabled={connectorsEnabled}
          busy={status === "streaming"}
          onStop={interrupt}
          onSubmit={(v) => {
            pinToBottom();
            void send(v);
          }}
        />
      </div>
    </div>
  );

  // Flag-off: return the chat column exactly as before (byte-identical). Flag-on:
  // wrap it in a row that reveals the resizable canvas pane when a doc is open.
  if (!canvasEnabled) return chatColumn;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">{chatColumn}</div>
      {openDoc && <CanvasPane docId={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}
