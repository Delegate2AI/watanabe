import { log } from "@/lib/log";
import { defaultModelId, modelAllowlist, type ModelOption } from "./model-options";

export const MODELS_PROBE_URL = "https://api.anthropic.com/v1/models?limit=100";
export const PROBE_FAILURE_RETRY_MS = 10 * 60 * 1000;

interface Probe {
  ids: Set<string> | null;
  probedAt: number;
}

const g = globalThis as unknown as {
  __agentServedModels?: Probe;
  __agentDroppedModels?: Set<string>;
};

function droppedLog(): Set<string> {
  g.__agentDroppedModels ??= new Set<string>();
  return g.__agentDroppedModels;
}

export function clearServedModelCache(): void {
  delete g.__agentServedModels;
  delete g.__agentDroppedModels;
}

function credentialHeaders(): Record<string, string> | null {
  const oauth = process.env.AGENT_CHAT_OAUTH_TOKEN?.trim();
  if (oauth) {
    return {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      Authorization: `Bearer ${oauth}`,
    };
  }
  const apiKey = process.env.AGENT_CHAT_API_KEY?.trim();
  if (apiKey) return { "anthropic-version": "2023-06-01", "x-api-key": apiKey };
  return null;
}

export async function servedModelIds(now: number = Date.now()): Promise<Set<string> | null> {
  const cached = g.__agentServedModels;
  if (cached && cached.ids !== null) return cached.ids;
  if (cached && now - cached.probedAt < PROBE_FAILURE_RETRY_MS) return null;

  const headers = credentialHeaders();
  if (!headers) {
    g.__agentServedModels = { ids: null, probedAt: now };
    return null;
  }
  try {
    const res = await fetch(MODELS_PROBE_URL, { headers });
    if (!res.ok) throw new Error(`models probe returned ${res.status}`);
    const body = (await res.json()) as { data?: { id?: string }[] };
    const ids = new Set<string>();
    for (const entry of body.data ?? []) {
      if (typeof entry?.id === "string" && entry.id) ids.add(entry.id);
    }
    if (ids.size === 0) throw new Error("models probe returned no ids");
    g.__agentServedModels = { ids, probedAt: now };
    return ids;
  } catch (err) {
    log.warn("served-model probe failed", { err: String(err) });
    g.__agentServedModels = { ids: null, probedAt: now };
    return null;
  }
}

export async function availableModelAllowlist(now: number = Date.now()): Promise<ModelOption[]> {
  const configured = modelAllowlist();
  const served = await servedModelIds(now);
  if (!served) return configured;

  const fallback = defaultModelId();
  const kept: ModelOption[] = [];
  for (const option of configured) {
    if (served.has(option.id) || option.id === fallback) {
      kept.push(option);
      continue;
    }
    if (droppedLog().has(option.id)) continue;
    droppedLog().add(option.id);
    log.warn("model dropped from the allowlist", { model: option.id });
  }
  return kept;
}
