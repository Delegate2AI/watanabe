"use client";

import { useEffect, useState } from "react";

/**
 * The client half of the capability contract (spec: failure and feedback).
 *
 * A capability is a precondition the app can know before render, not an error it
 * discovers on click. `GET /api/capabilities` answers with booleans only; this
 * hook holds them, and `isUnavailable` is the single predicate a control uses to
 * decide whether to disable itself.
 *
 * The load-bearing rule: unknown is NOT unavailable. A capability starts
 * `undefined` and stays `undefined` if the probe fails, and `isUnavailable`
 * answers false for `undefined`. A transient fetch failure therefore leaves every
 * control enabled and lets the click path surface a mapped message, rather than
 * disabling the app because one request did not land.
 */

/** What `GET /api/capabilities` reports. Booleans only, never a token. */
export interface Capabilities {
  /** This deployment can write to the knowledge base (flag on and credential present). */
  kbWrite: boolean;
  /** Voice dictation is configured (flag on and a transcription backend set). */
  dictation: boolean;
  shortFormContent: boolean;
}

/** A capability as the client knows it: true, false, or not yet known. */
export type CapabilityState = boolean | undefined;

/**
 * Whether a control should render disabled with an explanatory line.
 *
 * Strictly `=== false`. Unknown leaves the control enabled on purpose: an app
 * that greys out its own buttons because a probe timed out is worse than one
 * that lets the click fail with a mapped message.
 */
export function isUnavailable(state: CapabilityState): boolean {
  return state === false;
}

export interface CapabilitiesState {
  kbWrite: CapabilityState;
  dictation: CapabilityState;
  shortFormContent: CapabilityState;
  /** True until the probe has settled, one way or the other. */
  loading: boolean;
}

/** Narrow an unknown response body to the capability shape, or nothing. */
function parse(body: unknown): Capabilities | null {
  if (typeof body !== "object" || body === null) return null;
  const { kbWrite, dictation, shortFormContent } = body as Record<string, unknown>;
  if (typeof kbWrite !== "boolean" || typeof dictation !== "boolean") return null;
  // Tolerated as absent rather than required: an older client polling a newer
  // server (or the reverse, mid-deploy) must not lose every capability because
  // one key is missing. Absent reads as FALSE, not unknown, because the only
  // consumer is an additive card and a card that appears then vanishes is a
  // worse flicker than one that never appeared. Do not "fix" this to
  // `undefined`: `Capabilities` is booleans only, by contract.
  return {
    kbWrite,
    dictation,
    shortFormContent: typeof shortFormContent === "boolean" ? shortFormContent : false,
  };
}

/**
 * Probe this deployment's capabilities once per mount.
 *
 * Degrades quietly in every failure mode (rejected fetch, non-ok status,
 * unparseable body): the capabilities stay `undefined` and `loading` goes false,
 * so callers can tell "still asking" from "asked, no answer" without either one
 * disabling a control.
 */
export function useCapabilities(): CapabilitiesState {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/capabilities");
        if (!res.ok) return;
        const parsed = parse(await res.json());
        if (!cancelled && parsed) setCapabilities(parsed);
      } catch {
        // Unknown, not unavailable: leave the state null so nothing disables.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    kbWrite: capabilities?.kbWrite,
    dictation: capabilities?.dictation,
    shortFormContent: capabilities?.shortFormContent,
    loading,
  };
}
