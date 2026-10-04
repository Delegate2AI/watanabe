"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, MessageSquare, Pencil, Shield, Trash2 } from "lucide-react";
import {
  ChatContextProvider,
  useChatContext,
} from "@/components/agent/chat-context-provider";
import { AccessModal } from "./access-modal";
import { DeleteDocModal } from "./delete-doc-modal";
import { MAX_SELECTION_BYTES, type MessageContext } from "@/lib/agent/context";
import { messageForBody } from "@/lib/errors/messages";

const LazyAgentChat = lazy(async () => {
  const loaded = await import("@/components/agent/agent-chat");
  return { default: loaded.AgentChat };
});

export interface DocActionCapabilities {
  canProposeEdit: boolean;
  isAdmin: boolean;
  canDelete: boolean;
  groups: string[];
  requesterEmail: string;
}

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60";

function deepLink(relPath: string): string {
  const slug = relPath.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
  return `/kb/${slug}`;
}

function wholeDocumentContext(title: string, body: string, relPath: string): MessageContext {
  const selectedText = (body || title).slice(0, MAX_SELECTION_BYTES);
  return {
    type: "doc-selection",
    path: relPath,
    headingTrail: [],
    startLine: 1,
    endLine: selectedText.split("\n").length,
    selectedText,
    docTitle: title,
  };
}

function ContextSeeder({ context }: { context: MessageContext }) {
  const chat = useChatContext();
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !chat) return;
    seeded.current = true;
    chat.addChip(context);
  }, [chat, context]);

  return null;
}

function DocumentChat({
  context,
  requesterEmail,
}: {
  context: MessageContext;
  requesterEmail: string;
}) {
  return (
    <ChatContextProvider>
      <ContextSeeder context={context} />
      <Suspense fallback={<p className="text-sm text-ink-muted">Opening chat...</p>}>
        <LazyAgentChat compact identity={{ email: requesterEmail }} />
      </Suspense>
    </ChatContextProvider>
  );
}

export function DocActions({
  title,
  body,
  relPath,
  capabilities,
}: {
  title: string;
  body: string;
  relPath: string;
  capabilities: DocActionCapabilities;
}) {
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useMemo(
    () => wholeDocumentContext(title, body, relPath),
    [body, relPath, title],
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(deepLink(relPath), window.location.origin).href);
      setCopied(true);
    } catch {
      setError("The link could not be copied.");
    }
  }

  async function proposeEdit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only which note is meant. The body this component holds came from the
        // reader's clearance projection, which has had links to notes they
        // cannot see stripped out of it; sending it would publish those
        // deletions back over the canonical note. The server reads the source.
        body: JSON.stringify({ sourcePath: relPath }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(messageForBody(result));
        return;
      }
      router.push(`/artifacts/${(result as { id: string }).id}`);
    } catch {
      setError("The artifact draft could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div role="toolbar" aria-label="Document actions" className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => setChatOpen(true)}>
          <MessageSquare className="size-4" aria-hidden />
          Ask about this
        </button>
        <button type="button" className={BUTTON} onClick={copyLink}>
          <LinkIcon className="size-4" aria-hidden />
          {copied ? "Copied" : "Copy link"}
        </button>
        {capabilities.canProposeEdit ? (
          <button type="button" className={BUTTON} disabled={pending} onClick={proposeEdit}>
            <Pencil className="size-4" aria-hidden />
            {pending ? "Creating draft..." : "Propose an edit"}
          </button>
        ) : null}
        {capabilities.isAdmin ? (
          <button type="button" className={BUTTON} onClick={() => setAccessOpen(true)}>
            <Shield className="size-4" aria-hidden />
            Manage access
          </button>
        ) : null}
        {capabilities.canDelete ? (
          <button type="button" className={BUTTON} onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-warn">{error}</p> : null}
      {chatOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Chat about ${title}`}
        >
          <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-card border border-line bg-surface p-5 shadow-elevated">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">Chat about {title}</h2>
              <button type="button" className={BUTTON} onClick={() => setChatOpen(false)}>Close</button>
            </div>
            <div className="min-h-0 flex-1">
              <DocumentChat context={context} requesterEmail={capabilities.requesterEmail} />
            </div>
          </div>
        </div>
      ) : null}
      {accessOpen ? (
        <AccessModal
          path={relPath}
          isDirectory={false}
          groups={capabilities.groups}
          onClose={() => setAccessOpen(false)}
        />
      ) : null}
      {deleteOpen ? <DeleteDocModal path={relPath} onClose={() => setDeleteOpen(false)} /> : null}
    </>
  );
}
