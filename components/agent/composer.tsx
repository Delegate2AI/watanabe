"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation } from "@/components/kit/use-dictation";
import { ModelSelector } from "@/components/kit/model-selector";
import { useAppConfig } from "@/components/app-config-provider";
import { labelForEffort, labelForModel, type ModelOption } from "@/lib/agent/model-options";

/** Min/max height for the input: roomy enough for ~3 lines before it grows. */
const MIN_H = 76;
const MAX_H = 240;
const DEFAULT_PLACEHOLDER = "Ask anything about your knowledge base...";

/**
 * Composer for the knowledge-base chat: an auto-growing textarea with
 * Enter-to-send. Voice dictation (the mic) and the model / reasoning switch are
 * shared with the main app composer (`useDictation`, `ModelSelector`) so the
 * embed chat has parity with the rest of the app. Both degrade to a disabled or
 * inert control unless enabled server-side (`isDictationEnabled()`,
 * `isModelSwitchingEnabled()`) and threaded down. There is still no upload route
 * here. Model switching writes the per-thread override via the ModelSelector,
 * which the next resumed turn reads (lib/agent/session.ts), so no separate embed
 * backend is needed.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  prefill,
  dictationEnabled = false,
  modelThreadId,
  models = [],
  modelSwitchingEnabled = false,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  /** Bumping `nonce` drops `text` into the field and focuses it (starter cards). */
  prefill?: { text: string; nonce: number };
  /** Whether voice dictation is configured server-side (isDictationEnabled). */
  dictationEnabled?: boolean;
  /** The current chat thread id, scoping the model override (null before send). */
  modelThreadId?: string;
  /** Server-resolved model allowlist for the selector (empty when off). */
  models?: ModelOption[];
  /** Whether per-chat model switching is enabled server-side (AGENT_CHAT_MODELS). */
  modelSwitchingEnabled?: boolean;
}) {
  const placeholder = useAppConfig()?.app.composerPlaceholder ?? DEFAULT_PLACEHOLDER;
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H)}px`;
  };

  // Dictation fills the field, it never sends: append the transcript to whatever
  // has already been typed, then re-grow the textarea to fit it.
  const dictation = useDictation((text) => {
    setValue((v) => (v.trim() ? `${v.trimEnd()} ${text}` : text));
    requestAnimationFrame(autosize);
  });

  // "Adjusting state when a prop changes" — https://react.dev/learn/you-might-not-need-an-effect.
  // Setting `value` here (during render, guarded by a "last seen nonce" check)
  // avoids an extra render pass vs. doing it in an effect, and keeps the
  // effect below free of any direct setState call.
  const [lastPrefillNonce, setLastPrefillNonce] = useState(prefill?.nonce ?? 0);
  if (prefill && prefill.nonce !== lastPrefillNonce) {
    setLastPrefillNonce(prefill.nonce);
    // Additive, never a replacement: the starters are sentence openers, so they
    // land in front of whatever has already been typed rather than deleting it.
    setValue((current) => (current.trim() ? `${prefill.text}${current.trimStart()}` : prefill.text));
  }

  // Focus + autosize (imperative DOM effects, no state) once the prefilled
  // value has committed.
  useEffect(() => {
    if (!prefill?.nonce) return;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prefill.text.length, prefill.text.length);
      autosize();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const canSend = !busy && value.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    // Concentric radius: inner buttons are `rounded-lg` (8px) inside `p-2`
    // (8px), so the outer shell must be 16px — `rounded-2xl`, not `rounded-xl`.
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-sm">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autosize();
        }}
        onKeyDown={onKeyDown}
        style={{ minHeight: MIN_H, maxHeight: MAX_H }}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
      />

      <div className="mt-1 flex items-center gap-2">
        <ModelSelector
          threadId={modelThreadId}
          model={labelForModel(models)}
          level={labelForEffort()}
          options={models}
          enabled={modelSwitchingEnabled}
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label={dictation.recording ? "Stop dictation" : "Dictate"}
            aria-pressed={dictation.recording}
            disabled={!dictationEnabled || dictation.busy}
            title={dictationEnabled ? "Dictate a message" : "Dictation is not enabled"}
            onClick={dictation.toggle}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50",
              dictation.recording
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                : "text-[var(--color-ink-muted)]",
            )}
          >
            <Mic className="h-4 w-4" />
          </button>

          {/* One button, two stacked icons. These used to be two separately
              mounted buttons, so the send→stop swap popped instantly; keeping
              both icons in the DOM lets them cross-fade (`.icon-swap`, see
              app/globals.css) and spares the remount on every turn. */}
          <button
            type="button"
            onClick={busy ? onStop : submit}
            disabled={!busy && !canSend}
            title={busy ? "Stop" : "Send"}
            aria-label={busy ? "Stop" : "Send"}
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition",
              // Press feedback only when the button actually does something.
              busy
                ? "bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-line)] active:scale-[0.96]"
                : canSend
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90 active:scale-[0.96]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]",
            )}
          >
            <ArrowUp className={cn("icon-swap h-4 w-4", busy ? "icon-swap-out" : "icon-swap-in")} />
            <Square className={cn("icon-swap h-4 w-4", busy ? "icon-swap-in" : "icon-swap-out")} />
          </button>
        </div>
      </div>
    </div>
  );
}
