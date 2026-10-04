"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side loader for a single chat document's canvas view (spec 29). Fetches
 * `GET /api/chat-docs/[id]` (versions + per-target promotion status + which
 * Promote targets are enabled) and exposes a `reload` so Promote/Update can
 * refresh the pane. All shapes are declared locally so no server module (and no
 * server value) ever enters the client bundle.
 */

export type UpdateStatus = "up_to_date" | "chat_ahead" | "diverged";

export interface PromotionView {
  targetType: "artifact" | "shared_doc";
  targetId: string;
  promotedVersion: number;
  targetVersionAtPromote: number;
  targetCurrentVersion: number;
  classification: { status: UpdateStatus; warn: boolean; projectedTargetVersion: number };
}

/**
 * What a version's body is. Declared locally, like every other shape in this
 * file, so no server module reaches the client bundle. Optional because an older
 * server may not send it, and absent reads as markdown: the value every row
 * written before the column existed carries.
 */
export type CanvasDocFormat = "md" | "html";

export interface CanvasDocData {
  doc: { id: string; title: string; currentVersion: number; updatedAt: string };
  versions: Array<{ version: number; body: string; format?: CanvasDocFormat; createdAt: string }>;
  promotions: PromotionView[];
  flags: { artifactsEnabled: boolean; sharedDocsEnabled: boolean };
}

export interface UseChatDocState {
  data: CanvasDocData | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Pure fetch (no React state). Returns the data or a user-facing error string. */
async function fetchChatDoc(docId: string): Promise<{ data: CanvasDocData } | { error: string }> {
  try {
    const res = await fetch(`/api/chat-docs/${encodeURIComponent(docId)}`);
    if (!res.ok) {
      return { error: res.status === 404 ? "This document is no longer available." : "Failed to load the document." };
    }
    return { data: (await res.json()) as CanvasDocData };
  } catch {
    return { error: "Failed to load the document." };
  }
}

export function useChatDoc(docId: string | null): UseChatDocState {
  const [data, setData] = useState<CanvasDocData | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(docId));
  const [error, setError] = useState<string | null>(null);

  // Mount/refetch: the setState calls all happen AFTER the awaited fetch (never
  // synchronously in the effect body), matching the repo's use-chat pattern.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchChatDoc(docId);
      if (cancelled) return;
      if ("data" in result) {
        setData(result.data);
        setError(null);
      } else {
        setData(null);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // Only called from event handlers (Promote/Update), where an up-front loading
  // flip is fine (this is not an effect).
  const reload = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    setError(null);
    const result = await fetchChatDoc(docId);
    if ("data" in result) {
      setData(result.data);
    } else {
      setData(null);
      setError(result.error);
    }
    setLoading(false);
  }, [docId]);

  return { data, loading, error, reload };
}
