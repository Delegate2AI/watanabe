import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmPeriod, ModelGroup } from "@/lib/llm/types";

interface Row {
  slug: string;
  label: string;
  models: string;
  default_tokens: number | null;
  period: LlmPeriod;
}

/** A corrupt list reads as empty: the group then matches nothing, which blocks rather than opens. */
function parseModels(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function upsertModelGroup(db: DatabaseType, group: ModelGroup, now: string = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO llm_model_groups (slug, label, models, default_tokens, period, created_at, updated_at)
     VALUES (@slug, @label, @models, @defaultTokens, @period, @now, @now)
     ON CONFLICT (slug) DO UPDATE SET label = @label, models = @models,
       default_tokens = @defaultTokens, period = @period, updated_at = @now`,
  ).run({
    slug: group.slug,
    label: group.label.trim(),
    models: JSON.stringify(group.models),
    defaultTokens: group.defaultTokens,
    period: group.period,
    now,
  });
}

export function listModelGroups(db: DatabaseType): ModelGroup[] {
  const rows = db
    .prepare(`SELECT slug, label, models, default_tokens, period FROM llm_model_groups ORDER BY slug`)
    .all() as Row[];
  return rows.map((r) => ({
    slug: r.slug,
    label: r.label,
    models: parseModels(r.models),
    defaultTokens: r.default_tokens,
    period: r.period,
  }));
}

export function deleteModelGroup(db: DatabaseType, slug: string): boolean {
  return db.prepare(`DELETE FROM llm_model_groups WHERE slug = @slug`).run({ slug }).changes > 0;
}
