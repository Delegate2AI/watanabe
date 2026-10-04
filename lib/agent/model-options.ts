/**
 * The allowlist of models and reasoning levels a contributor may switch a chat
 * to (spec 24). Switching is bounded: only ids on this list are honored, and an
 * unknown model or effort silently falls back to the default rather than being
 * passed through to the SDK. The env `AGENT_CHAT_MODEL` stays the default AND
 * the base entry, so an unconfigured deploy still has exactly one valid choice.
 *
 * CLIENT-SAFE: the composer's selector imports the labels and levels from here,
 * so keep this free of node-only imports. The cost/turn ceilings that bound a
 * switch live in `config.ts` (env `AGENT_MAX_BUDGET_USD`/`AGENT_MAX_TURNS`) and
 * are applied regardless of the model choice.
 */

/** SDK reasoning-effort levels (see `@anthropic-ai/claude-agent-sdk` EffortLevel). */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** The reasoning level a fresh chat runs at unless overridden (spec: High). */
export const DEFAULT_EFFORT: EffortLevel = "high";

export interface ModelOption {
  id: string;
  label: string;
  hint?: string;
  tier?: number;
}

export interface ModelChoice {
  model: string;
  effort: EffortLevel;
}

/** A loosely-typed choice as it arrives from the DB or an HTTP body (unvalidated). */
export interface ModelChoiceInput {
  model?: string | null;
  effort?: string | null;
}

/** The env-configured default model id (the hard base of the allowlist). */
export function defaultModelId(): string {
  return process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8";
}

/**
 * Whether per-chat model/effort switching is ENABLED. It is dormant unless
 * `AGENT_CHAT_MODELS` is configured (a non-empty list of ids). Flag-off, the
 * feature adds NOTHING to the SDK option shape (`buildOptions` sets `model`
 * exactly as before and no `effort` field) and the composer's selector renders
 * an inert label, so an unconfigured deploy is byte-identical to pre-spec-24.
 *
 * SERVER-ONLY signal: reads `AGENT_CHAT_MODELS`, which is not exposed to the
 * browser. Client code must receive the resolved allowlist + this flag as
 * props, never call this directly (it would always read `undefined` client-side
 * and silently disable the feature).
 */
export function isModelSwitchingEnabled(): boolean {
  return Boolean(process.env.AGENT_CHAT_MODELS?.trim());
}

interface CuratedModel {
  label: string;
  hint: string;
  tier: number;
}

const CURATED_MODELS: Record<string, CuratedModel> = {
  "claude-fable-5-1": { label: "Fable 5.1", hint: "Most capable", tier: 3 },
  "claude-opus-5": { label: "Opus 5", hint: "Best all-round", tier: 2 },
  "claude-opus-4-8": { label: "Opus 4.8", hint: "Current default", tier: 2 },
  "claude-sonnet-5": { label: "Sonnet 5", hint: "Fast", tier: 1 },
  "claude-haiku-4-5-20251001": { label: "Haiku 4.5", hint: "Fastest, cheapest", tier: 0 },
};

function derivedLabel(id: string): string {
  const m = id.match(/claude-(opus|sonnet|haiku|fable)-(\d+)-?(\d+)?/i);
  if (!m) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}`;
}

function optionFor(id: string): ModelOption {
  const curated = CURATED_MODELS[id];
  if (!curated) return { id, label: derivedLabel(id) };
  return { id, label: curated.label, hint: curated.hint, tier: curated.tier };
}

export function modelAllowlist(): ModelOption[] {
  const ids = [defaultModelId()];
  const extra = process.env.AGENT_CHAT_MODELS?.trim();
  if (extra) {
    for (const raw of extra.split(",")) {
      const id = raw.trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids.map(optionFor);
}

export function labelForModel(options: readonly ModelOption[], id?: string | null): string {
  const match = options.find((m) => m.id === id);
  if (match) return match.label;
  return options[0]?.label ?? optionFor(defaultModelId()).label;
}

export function labelForEffort(effort?: string | null): string {
  const level = isEffortLevel(effort) ? effort : DEFAULT_EFFORT;
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function isAllowedModel(id: string): boolean {
  return modelAllowlist().some((m) => m.id === id);
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Validate a requested choice against the allowlist, falling back per-field to
 * the default. An unknown model or a non-level effort is dropped, never passed
 * to the SDK. Always returns a fully-resolved, safe `{ model, effort }`.
 */
export function resolveModelChoice(choice?: ModelChoiceInput | null): ModelChoice {
  const model = choice?.model && isAllowedModel(choice.model) ? choice.model : defaultModelId();
  const effort = isEffortLevel(choice?.effort) ? choice.effort : DEFAULT_EFFORT;
  return { model, effort };
}
