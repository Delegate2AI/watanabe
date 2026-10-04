"use client";

import { useEffect, useState, type RefObject } from "react";
import { type ComposerPrefill, mergeSeed } from "./composer-prefill";

/**
 * Apply a quick-action seed to the composer field and hand the caret over.
 *
 * Two halves that have to stay together, which is why they live in one hook:
 *
 * 1. Seeding. Done during render, guarded by the last applied nonce
 *    (https://react.dev/learn/you-might-not-need-an-effect) rather than in an
 *    effect, which would paint the un-seeded field for a frame first. The last
 *    applied seed is remembered so a SECOND chip swaps the opener instead of
 *    stacking it (see `mergeSeed`).
 *
 * 2. Focus. Seeding the text is only half the interaction: the contributor's
 *    next act is to finish the sentence, so the caret must be waiting at the end
 *    of it. Without this the chip filled the box but left focus on the chip, so
 *    everything typed next went nowhere and the bare opener ("Help me write a
 *    doc about") is what actually got sent. Keyed on the applied nonce, so it
 *    fires once per click and never steals focus on an ordinary re-render.
 */
export function usePrefillSeed(
  prefill: ComposerPrefill | undefined,
  setValue: (update: (current: string) => string) => void,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
): void {
  const [lastNonce, setLastNonce] = useState(prefill?.nonce ?? 0);
  const [seededPrefix, setSeededPrefix] = useState("");

  if (prefill && prefill.nonce !== lastNonce) {
    setLastNonce(prefill.nonce);
    setValue((current) => mergeSeed(current, seededPrefix, prefill.text));
    setSeededPrefix(prefill.text);
  }

  useEffect(() => {
    if (lastNonce === 0) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }, [lastNonce, fieldRef]);
}
