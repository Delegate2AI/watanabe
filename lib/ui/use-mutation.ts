"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { codeFromBody, messageFor } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "./toast";

/**
 * One wrapper for "change something on the server and tell the person what
 * happened".
 *
 * Before this, a successful assign, accept, remove, or revoke just changed the
 * screen and a failure rendered whatever string the route happened to return.
 * Every mutation now confirms, every failure renders copy mapped from a reason
 * code, and a change the server can reverse in one call carries an Undo.
 *
 * Failure copy is derived ONLY through `messageFor(codeFromBody(body))`. There is
 * no path from a response body to the screen: an unmigrated route returning
 * `{ error: "<free text>" }` yields no code, so the user sees the generic
 * sentence rather than the internal string.
 */

export interface MutationRequest {
  url: string;
  /** Defaults to POST. */
  method?: string;
  /** JSON-encoded when present. Omit for a bodyless DELETE or POST. */
  body?: unknown;
}

/** A one-call reversal offered on the success toast. */
export interface UndoConfig {
  /** Button copy. Defaults to "Undo". */
  label?: string;
  /** The reversing call. */
  request: MutationRequest;
  /** Copy confirming the reversal landed. */
  success: string;
}

export interface MutationConfig<T> {
  /** Success copy: a fixed sentence, or one derived from the parsed result. */
  success: string | ((result: T) => string);
  /**
   * Build the reversal for this result, or return undefined when the change is
   * not reversible in one call. Called only on success.
   */
  undo?: (result: T) => UndoConfig | undefined;
  onSuccess?: (result: T) => void;
  /** The reason code, when the server sent one this build recognizes. */
  onError?: (code: string | undefined) => void;
}

export type MutationOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; code: string | undefined; message: string };

export interface MutationHandle<T> {
  run: (request: MutationRequest) => Promise<MutationOutcome<T>>;
  /** True while a request from this handle is in flight. */
  pending: boolean;
}

/** Issue one request and hand back its status plus its parsed body. */
async function send(request: MutationRequest): Promise<{ ok: boolean; body: unknown } | null> {
  const init: RequestInit = { method: request.method ?? "POST" };
  if (request.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(request.body);
  }
  let res: Response;
  try {
    res = await fetch(request.url, init);
  } catch {
    // A transport failure carries an exception message full of hostnames and
    // ports. It never reaches the screen: the caller renders the generic copy.
    return null;
  }
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

export function useMutation<T = unknown>(config: MutationConfig<T>): MutationHandle<T> {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  // The config is read at call time, so a caller may close over fresh state
  // without having to memoize it, and `run` stays referentially stable. Synced
  // in an effect, never during render: a ref write during render is both a lint
  // error here and a real hazard under concurrent rendering.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runUndo = useCallback(async (undo: UndoConfig) => {
    const response = await send(undo.request);
    if (response?.ok) {
      notifySuccess(undo.success);
      return;
    }
    notifyFailure(messageFor(codeFromBody(response?.body)));
  }, []);

  const run = useCallback(
    async (request: MutationRequest): Promise<MutationOutcome<T>> => {
      setPending(true);
      try {
        const response = await send(request);
        if (!response || !response.ok) {
          const code = codeFromBody(response?.body);
          const message = messageFor(code);
          notifyFailure(message);
          configRef.current.onError?.(code);
          return { ok: false, code, message };
        }

        const result = response.body as T;
        const { success, undo, onSuccess } = configRef.current;
        const copy = typeof success === "function" ? success(result) : success;
        const reversal = undo?.(result);
        notifySuccess(
          copy,
          reversal ? { label: reversal.label ?? "Undo", onClick: () => void runUndo(reversal) } : undefined,
        );
        onSuccess?.(result);
        return { ok: true, result };
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [runUndo],
  );

  return { run, pending };
}
