function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` is the only wildcard; everything else in a pattern is literal. */
export function modelMatches(pattern: string, model: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const source = trimmed.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${source}$`).test(model);
}

/** Groups in the order the gate tries them: by slug. The first match wins. */
export function bySlug<G extends { slug: string }>(groups: G[]): G[] {
  return [...groups].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function groupForModel<G extends { slug: string; models: string[] }>(groups: G[], model: string): G | null {
  return bySlug(groups).find((g) => g.models.some((p) => modelMatches(p, model))) ?? null;
}
