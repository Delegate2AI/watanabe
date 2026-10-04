import type { FlagDescriptor } from "./flag-descriptor";

export const KNOWLEDGE_FLAGS: readonly FlagDescriptor[] = [
  {
    envVar: "MEMORY_ENABLED",
    label: "Memory",
    description: "Stores and recalls durable agent memory from the private memory branch.",
    effect: "restart",
  },
  {
    envVar: "INDEX_ENABLED",
    label: "Index",
    description: "Builds and serves the generated knowledge base index.",
    effect: "restart",
  },
  {
    envVar: "KB_GRAPH_ENABLED",
    label: "KB graph",
    description: "Shows the knowledge base link graph as a tab on the vault map.",
    effect: "live",
  },
  {
    envVar: "QUALITY_GATES_ENABLED",
    label: "Quality gates",
    description: "Runs automated quality checks before knowledge base submissions.",
    dependsOn: "KB_WRITE_ENABLED",
    effect: "live",
  },
  {
    envVar: "INTEGRITY_ENABLED",
    label: "Integrity check",
    description: "Flags duplicate or contradicting content against the rest of the knowledge base at submit time.",
    dependsOn: "QUALITY_GATES_ENABLED",
    effect: "live",
  },
  {
    envVar: "PACKAGES_ENABLED",
    label: "Packages",
    description: "Accepts and processes update packages through the write path.",
    dependsOn: "KB_WRITE_ENABLED",
    effect: "restart",
  },
  {
    envVar: "KB_WRITE_ENABLED",
    label: "Knowledge base writes",
    description: "Enables reviewable knowledge base edit and submission tools.",
    effect: "restart",
  },
  {
    envVar: "AUTHORITY_ENABLED",
    label: "Authority",
    description: "Applies group clearance to knowledge base reads and administration.",
    effect: "live",
  },
  {
    envVar: "MEETINGS_ENABLED",
    label: "Meetings",
    description: "Enables meeting ingestion, processing, and meeting views.",
    dependsOn: "KB_WRITE_ENABLED",
    effect: "restart",
  },
] as const;
