"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentChip } from "@/lib/attachments/store";
import { codeFromBody, messageForBody } from "@/lib/errors/messages";

const ATTACHMENT_MESSAGES: Readonly<Record<string, string>> = {
  unsupported_file: "That kind of file cannot be attached. Try a text, Markdown, CSV, JSON, image or PDF file.",
  file_too_large: "That file is too large to attach. Try a smaller one.",
};

function attachmentMessage(body: unknown): string {
  const code = codeFromBody(body);
  return (code && ATTACHMENT_MESSAGES[code]) ?? messageForBody(body);
}

export function useAttachments(threadId?: string, onThreadMinted?: (id: string) => void, enabled = true) {
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<string | undefined>(threadId);
  const mintedRef = useRef<string | undefined>(undefined);
  const mintInFlightRef = useRef<Promise<string | null> | null>(null);
  const uploadsInFlightRef = useRef(0);

  useEffect(() => {
    if (threadId) threadRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    if (!enabled || !threadId || threadId === mintedRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/attachments?threadId=${encodeURIComponent(threadId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { attachments?: AttachmentChip[] };
        if (!cancelled && Array.isArray(body.attachments)) setAttachments(body.attachments);
      } catch {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, threadId]);

  const mint = useCallback(async (): Promise<string | null> => {
    if (!enabled) return null;
    try {
      const res = await fetch("/api/threads", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      if (!res.ok || !body?.id) {
        setError(attachmentMessage(body));
        return null;
      }
      threadRef.current = body.id;
      mintedRef.current = body.id;
      onThreadMinted?.(body.id);
      return body.id;
    } catch {
      setError("could not start a chat for this file");
      return null;
    }
  }, [enabled, onThreadMinted]);

  const ensureThread = useCallback(async (): Promise<string | null> => {
    if (threadRef.current) return threadRef.current;
    if (!mintInFlightRef.current) mintInFlightRef.current = mint();
    const id = await mintInFlightRef.current;
    if (!id) mintInFlightRef.current = null;
    return id;
  }, [mint]);

  const upload = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!enabled || !files || files.length === 0) return;
      setError(null);
      uploadsInFlightRef.current += 1;
      setPending(true);
      try {
        const target = await ensureThread();
        if (!target) return;
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.set("file", file);
          form.set("threadId", target);
          try {
            const res = await fetch("/api/attachments", { method: "POST", body: form });
            const body = (await res.json().catch(() => null)) as { attachment?: AttachmentChip } | null;
            if (!res.ok || !body?.attachment) {
              setError(attachmentMessage(body));
              continue;
            }
            setAttachments((prev) => [...prev, body.attachment as AttachmentChip]);
          } catch {
            setError("could not attach file");
          }
        }
        if (inputRef.current) inputRef.current.value = "";
      } finally {
        uploadsInFlightRef.current -= 1;
        if (uploadsInFlightRef.current === 0) setPending(false);
      }
    },
    [enabled, ensureThread],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const target = threadRef.current;
    if (!enabled || !target) return;
    try {
      const res = await fetch(
        `/api/attachments/${encodeURIComponent(id)}?threadId=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError(attachmentMessage(await res.json().catch(() => null)));
        return;
      }
    } catch {
      setError("could not remove file");
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, [enabled]);

  return {
    attachments,
    error,
    pending,
    inputRef,
    upload,
    remove,
    clear: () => setAttachments([]),
    pick: () => inputRef.current?.click(),
  };
}
