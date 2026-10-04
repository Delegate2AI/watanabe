// Same rules as lib/llm/match.ts; match.test.mjs keeps the two in step.

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` is the only wildcard; everything else in a pattern is literal. */
export function modelMatches(pattern, model) {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const source = trimmed.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${source}$`).test(model);
}

/** First group by slug order whose patterns match, or null. */
export function groupForModel(groups, model) {
  const ordered = [...groups].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return ordered.find((g) => g.models.some((p) => modelMatches(p, model))) ?? null;
}
