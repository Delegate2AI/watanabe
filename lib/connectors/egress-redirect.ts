export type RedirectKind = "always-get" | "post-becomes-get" | "preserve";

const REDIRECT_KINDS: Record<number, RedirectKind> = {
  301: "post-becomes-get",
  302: "post-becomes-get",
  303: "always-get",
  307: "preserve",
  308: "preserve",
};

export function classifyRedirectStatus(status: number): RedirectKind | null {
  return REDIRECT_KINDS[status] ?? null;
}

export function applyRedirectMethodRules(hopInit: RequestInit, kind: RedirectKind): void {
  const method = (hopInit.method ?? "GET").toUpperCase();
  const rewriteToGet = kind === "always-get" || (kind === "post-becomes-get" && method === "POST");
  if (!rewriteToGet) return;
  hopInit.method = "GET";
  delete hopInit.body;
}
