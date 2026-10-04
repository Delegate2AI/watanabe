"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";

/**
 * Starts PostHog for the signed-in shell.
 *
 * `distinctId` is a pseudonymous hash resolved server-side: this island never
 * sees an address, and no person property is ever sent, so the instance holds
 * usage without holding a staff directory. Session recording is off.
 *
 * Events go straight to the self-hosted host, matching the warpdrive apps on the
 * same instance. That host is not Cloudflare-proxied, so analytics never meets
 * the edge that already blocks uploads on this one.
 */
export function AnalyticsProvider({
  apiKey,
  distinctId,
  host,
}: {
  apiKey: string;
  distinctId: string;
  host: string;
}) {
  const started = useRef(false);

  useEffect(() => {
    // Someone who has asked not to be tracked is not tracked, even by a
    // first-party instance.
    if (started.current || navigator.doNotTrack === "1") return;
    started.current = true;
    posthog.init(apiKey, {
      api_host: host,
      // "history_change" covers client-side navigation; `true` fires only on the
      // document load, and this island lives in a layout that never remounts.
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: true,
      // Autocapture otherwise sends the text and attributes of whatever was
      // clicked, and the admin screens have staff addresses in both. Masked,
      // an event still says which control was used, and never who it named.
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      person_profiles: "identified_only",
    });
    // A shared browser otherwise keeps the previous person's identified state
    // and merges two people into one session.
    const previous = posthog.get_distinct_id?.();
    if (previous && previous !== distinctId && /^[0-9a-f]{32}$/.test(previous)) posthog.reset();
    posthog.identify(distinctId);
  }, [apiKey, distinctId, host]);

  // posthog-js autocaptures exceptions only from its own error boundaries, so
  // a throw that reaches the window is otherwise unreported.
  useEffect(() => {
    const capture = (error: unknown) => {
      const thrown = error instanceof Error ? error : new Error(String(error));
      posthog.captureException(thrown, { path: window.location.pathname });
    };
    const onError = (event: ErrorEvent) => capture(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => capture(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
