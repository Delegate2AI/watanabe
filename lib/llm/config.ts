import { isFlagEnabled } from "@/lib/config/flags";

export function isLlmKeysEnabled(): boolean {
  return isFlagEnabled("LLM_KEYS_ENABLED");
}

export interface LlmEnv {
  routerUrl: string | null;
  adminPassword: string | null;
  gateUrl: string | null;
  gateSecret: string | null;
  publicUrl: string | null;
}

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function llmEnv(): LlmEnv {
  return {
    routerUrl: read("LLM_ROUTER_URL"),
    adminPassword: read("NINEROUTER_ADMIN_PASSWORD"),
    gateUrl: read("LLM_GATE_URL"),
    gateSecret: read("LLM_GATE_SECRET"),
    publicUrl: read("LLM_PUBLIC_URL"),
  };
}
