import type { PortalConfig } from "@/lib/config/schema";

export type AgentPromptConfig = PortalConfig["agent"];

export const NO_HOUSE_RULES: AgentPromptConfig = {
  houseRules: [],
  houseRulesSummary: "",
  subjectName: "",
  memoryRules: [],
  memoryRulesSummary: "",
};

export function houseRulesSection(agent: AgentPromptConfig): string[] {
  if (agent.houseRules.length === 0) return [];
  return [
    "",
    "HOUSE RULES \u2014 apply these every time they're relevant",
    ...agent.houseRules.map((rule) => `- ${rule}`),
  ];
}

export function writeHouseRulesLine(agent: AgentPromptConfig): string[] {
  if (agent.houseRules.length === 0) return [];
  const summary = agent.houseRulesSummary ? ` (${agent.houseRulesSummary})` : "";
  return [
    `- Everything you draft must still follow the house rules above${summary} exactly as if you were answering a`,
    "  question \u2014 a commit is canon, not a casual answer.",
  ];
}

export function webFirstLine(agent: AgentPromptConfig): string[] {
  const subject = agent.subjectName ? `anything about ${agent.subjectName} itself` : "anything it covers";
  return [
    `- Prefer the knowledge base first for ${subject} \u2014`,
    "  the web should fill gaps, not override or contradict KB canon.",
  ];
}
