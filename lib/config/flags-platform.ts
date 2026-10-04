import type { FlagDescriptor } from "./flag-descriptor";

export const PLATFORM_FLAGS: readonly FlagDescriptor[] = [
  {
    envVar: "ANALYTICS_ENABLED",
    label: "Product analytics",
    description:
      "Sends pageviews, interactions, and client-side errors to the self-hosted PostHog, keyed by a pseudonymous id rather than a person's address. No session recording.",
    effect: "live",
  },
  {
    envVar: "ACTIVITY_ENABLED",
    label: "Activity",
    description: "Enables the combined activity feed and navigation entry.",
    effect: "live",
  },
  {
    envVar: "CANVAS_ENABLED",
    label: "Canvas",
    description: "Enables in-chat documents, canvas tools, and the canvas pane.",
    effect: "live",
  },
  {
    envVar: "HTML_DOCUMENTS_ENABLED",
    label: "Designed documents",
    description:
      "Lets the assistant author a document as a designed HTML page, and offers every document as PDF, HTML and Markdown.",
    dependsOn: "CANVAS_ENABLED",
    effect: "live",
  },
  {
    envVar: "ATTACHMENTS_ENABLED",
    label: "Attachments",
    description: "Allows thread-scoped file uploads for conversation context.",
    effect: "live",
  },
  {
    envVar: "DICTATION_ENABLED",
    label: "Dictation",
    description: "Enables voice transcription when a dictation backend is configured.",
    effect: "live",
  },
  {
    envVar: "KB_ACCESS_UI_ENABLED",
    label: "KB access admin",
    description: "Lets admins edit which groups can see a knowledge base file or folder from the tree.",
    dependsOn: "AUTHORITY_ENABLED",
    effect: "live",
  },
  {
    envVar: "PEOPLE_ENABLED",
    label: "People directory",
    description: "Names people from the private people directory instead of printing their email address.",
    effect: "live",
  },
  {
    envVar: "ALIASES_ADMIN_ENABLED",
    label: "Alias administration",
    description: "Lets admins map a person's other email addresses to their portal identity from the members list.",
    dependsOn: "AUTHORITY_ENABLED",
    effect: "live",
  },
  {
    envVar: "PEOPLE_ACTIVITY_ENABLED",
    label: "People",
    description: "Enables the people activity view of who is doing what across meetings and tasks.",
    effect: "live",
  },
  {
    envVar: "CONNECTORS_ENABLED",
    label: "External MCP connectors",
    description: "Admin-registered external MCP servers, clearance-tagged, per-thread opt-in.",
    effect: "live",
  },
  {
    envVar: "CONNECTOR_OAUTH_ENABLED",
    label: "Connector OAuth",
    description: "Per-user OAuth connections for external MCP connectors, the runtime kill switch for the connect flow, credential reads and bearer injection.",
    dependsOn: "CONNECTORS_ENABLED",
    effect: "live",
  },
  {
    envVar: "SKILLS_ENABLED",
    label: "Installable skills",
    description: "Admin-installed Agent Skills, clearance-tagged, loaded into chat sessions.",
    effect: "live",
  },
  {
    envVar: "RICH_EDITOR_ENABLED",
    label: "Rich editor",
    description: "Offers a WYSIWYG alternative to the raw markdown source when editing a document body.",
    effect: "live",
  },
  {
    envVar: "MEETINGS_WEBHOOK_ENABLED",
    label: "Circleback webhook ingestion",
    description: "Accepts signed Circleback webhook deliveries, so meetings recorded by other workspace members can be ingested.",
    dependsOn: "MEETINGS_ENABLED",
    effect: "live",
  },
  {
    envVar: "KB_REVIEW_ENABLED",
    label: "KB review queue",
    description:
      "Shows approvers the knowledge base changes waiting on review, and lets them merge or reject one.",
    effect: "live",
  },
  {
    envVar: "KB_DELETE_ENABLED",
    label: "KB delete",
    description:
      "Lets an admin propose removing a knowledge base note, as a reviewable change in the review queue.",
    dependsOn: "KB_WRITE_ENABLED",
    effect: "live",
  },
  {
    envVar: "DOC_COPILOT_ENABLED",
    label: "Doc copilot",
    description:
      "A chat panel on shared documents whose assistant proposes edits as suggestions for human review. It never edits the body or accepts anything itself. Off, the panel and its tools are dark.",
    dependsOn: "DOC_ANNOTATIONS_ENABLED",
    effect: "live",
  },
  {
    envVar: "USAGE_AUDIT_ENABLED",
    label: "Usage audit",
    description:
      "Records model usage and cost per turn and shows the ledger to administrators.",
    effect: "live",
  },
  {
    envVar: "LLM_KEYS_ENABLED",
    label: "Personal LLM keys",
    description:
      "Lets staff create their own LLM keys for coding harnesses, routed through 9router behind token budgets " +
      "that administrators set per model group, team and person.",
    effect: "live",
  },
] as const;
