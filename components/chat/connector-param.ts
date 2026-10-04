export function dropConnectorParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("connector")) return;
  url.searchParams.delete("connector");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function consumePendingConnectors(
  ref: { current: readonly string[] | undefined },
  resuming: boolean,
): readonly string[] | undefined {
  const pending = ref.current;
  ref.current = undefined;
  if (!pending || pending.length === 0) return undefined;
  dropConnectorParam();
  return resuming ? undefined : pending;
}
