import { isEffortLevel, type EffortLevel, type ModelOption } from "@/lib/agent/model-options";

export const MODEL_CHOICE_KEY = "watanabe.modelChoice";

export interface ChatModelChoice {
  model?: string;
  effort?: EffortLevel;
}

export function initialChoiceFrom(
  options: readonly ModelOption[],
  raw: { model?: string | null; effort?: string | null },
): ChatModelChoice {
  const choice: ChatModelChoice = {};
  if (raw.model && options.some((option) => option.id === raw.model)) choice.model = raw.model;
  if (isEffortLevel(raw.effort)) choice.effort = raw.effort;
  return choice;
}

export function readStoredChoice(options: readonly ModelOption[]): ChatModelChoice {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MODEL_CHOICE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { model?: unknown; effort?: unknown };
    return initialChoiceFrom(options, {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      effort: typeof parsed.effort === "string" ? parsed.effort : undefined,
    });
  } catch {
    return {};
  }
}

export function writeStoredChoice(choice: ChatModelChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODEL_CHOICE_KEY, JSON.stringify(choice));
  } catch {
    return;
  }
}
