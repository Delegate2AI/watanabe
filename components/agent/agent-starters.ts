import { BookOpen, GitBranch, Layers, Megaphone, Scale, type LucideIcon } from "lucide-react";

/**
 * Empty-state starter prompts for the knowledge-base assistant. Clicking
 * one PREFILLS the composer (editable) — it does not auto-send. The agent is
 * read-only in Phase 1 (see lib/agent/permissions.ts), so every prompt stays
 * inside "ask about the knowledge base," never "change the knowledge base."
 */
export type AgentStarter = {
  id: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  prompt: string;
};

export const AGENT_STARTERS: AgentStarter[] = [
  {
    id: "whats-in-the-kb",
    label: "What's in the knowledge base?",
    sub: "Overview",
    icon: BookOpen,
    prompt: "What's in the knowledge base? Give me the short version, grounded in docs/.",
  },
  {
    id: "recent-changes",
    label: "Summarize recent changes",
    sub: "What moved lately",
    icon: GitBranch,
    prompt: "Summarize what has changed in the knowledge base recently.",
  },
  {
    id: "draft-a-document",
    label: "Draft a document",
    sub: "Start from the knowledge base",
    icon: Layers,
    prompt: "Help me draft a document, grounded in what the knowledge base already says. The topic is ",
  },
  {
    id: "find-a-decision",
    label: "Find a decision",
    sub: "Why we chose what we chose",
    icon: Scale,
    prompt: "Find the decision recorded in the knowledge base about ",
  },
];

export const CONTENT_STARTER: AgentStarter = {
  id: "short-form-content",
  label: "Write a social post",
  sub: "Brand voice, grounded in the KB",
  icon: Megaphone,
  prompt: "Draft three LinkedIn post variants about ",
};
