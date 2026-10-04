"use client";

import { useEffect, useState } from "react";

type BannerState = { kind: "connected"; slug: string } | { kind: "error" } | null;

function readAndStripOauthParams(): BannerState {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const connected = url.searchParams.get("connected");
  const hasError = url.searchParams.get("error") === "oauth";
  if (!connected && !hasError) return null;

  const state: BannerState = connected ? { kind: "connected", slug: connected } : { kind: "error" };
  url.searchParams.delete("connected");
  url.searchParams.delete("error");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return state;
}

export function ConnectorOauthBanner() {
  const [state, setState] = useState<BannerState>(null);

  useEffect(() => {
    void Promise.resolve().then(() => setState(readAndStripOauthParams()));
  }, []);

  if (!state) return null;

  if (state.kind === "error") {
    return (
      <p role="alert" className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-warn">
        The connection could not be completed. Try again.
      </p>
    );
  }

  return (
    <p role="status" className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
      Connected. You can use this connector in a chat now.
    </p>
  );
}
