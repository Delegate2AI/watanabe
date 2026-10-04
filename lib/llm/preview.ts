import { bySlug, modelMatches } from "./match";

export interface ModelMatch {
  model: string;
  /** Every group whose patterns match, in slug order; the first one wins at the gate. */
  slugs: string[];
}

/**
 * Which groups each known model falls in, for the admin page's preview: a model
 * in no group is blocked for everyone, and a model in two groups goes to the
 * first by slug, which is easy to get wrong by accident.
 */
export function matchReport(groups: Array<{ slug: string; models: string[] }>, models: string[]): ModelMatch[] {
  const ordered = bySlug(groups);
  return [...new Set(models)].sort().map((model) => ({
    model,
    slugs: ordered.filter((g) => g.models.some((p) => modelMatches(p, model))).map((g) => g.slug),
  }));
}
