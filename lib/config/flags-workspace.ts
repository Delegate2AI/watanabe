import type { FlagDescriptor } from "./flag-descriptor";

export const WORKSPACE_FLAGS: readonly FlagDescriptor[] = [
  {
    envVar: "TASKS_ENABLED",
    label: "Tasks",
    description: "Enables task extraction, task APIs, and task views.",
    effect: "live",
  },
  {
    envVar: "TASK_COMMENTS_ENABLED",
    label: "Task comments",
    description: "Enables discussion on tasks: a comment list on the task, a count on the cards, and comment activity in What's New.",
    dependsOn: "TASKS_ENABLED",
    effect: "live",
  },
  {
    envVar: "ROLES_ENABLED",
    label: "Roles",
    description: "Enforces role-based capabilities for contributors and administrators.",
    effect: "live",
  },
  {
    envVar: "PROJECTS_ENABLED",
    label: "Projects",
    description: "Enables project workspaces and project context in conversations.",
    effect: "live",
  },
  {
    envVar: "ARTIFACTS_ENABLED",
    label: "Artifacts",
    description: "Enables saved artifacts and artifact publishing controls.",
    effect: "live",
  },
  {
    envVar: "SHARED_DOCS_ENABLED",
    label: "Shared documents",
    description: "Enables shared document creation, collaboration, and views.",
    effect: "live",
  },
  {
    envVar: "EXTERNAL_SHARE_ENABLED",
    label: "External sharing",
    description: "Allows signed unauthenticated links to shared documents.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "DOC_ANNOTATIONS_ENABLED",
    label: "Document annotations",
    description: "Enables anchored comment threads and proposed edits on shared documents.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "DOC_GROUP_SHARING_ENABLED",
    label: "Team sharing",
    description:
      "Lets a document be shared with a whole team, tracking that team's membership. Off, existing team grants stop resolving and only per-person shares apply.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "SHARED_DOC_PUBLISH_ENABLED",
    label: "Publish shared documents",
    description:
      "Lets a document owner submit a shared document to the knowledge base as a reviewable change. Off, a shared document's only disposition is who it is shared with.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "MCP_ENABLED",
    label: "Workspace MCP",
    description:
      "Serves /api/mcp to members with an MCP client, and runs the OAuth authorization server that lets one register itself. Each domain's tools follow that domain's own flag, so turning a feature off turns its tools off. Off, the endpoint and its discovery documents refuse.",
    effect: "live",
  },
  {
    envVar: "DOC_IMPORT_ENABLED",
    label: "Import documents",
    description:
      "Lets a person drop a Markdown or Word file onto their shared documents to import it. Off, a document can only be created by typing into the create dialog.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "DOC_ACCESS_REQUESTS_ENABLED",
    label: "Request document access",
    description:
      "Shows a person who opens a document they are not on a \"You need access\" screen they can ask the owner from, instead of a bare not-found. Off, the document is not found and no request can be made.",
    dependsOn: "SHARED_DOCS_ENABLED",
    effect: "live",
  },
  {
    envVar: "KB_PROPOSE_EDIT_ENABLED",
    label: "Propose an edit",
    description:
      "Lets a contributor open a draft edit of a knowledge base note, which lands as a reviewable change. The note's own visibility is always carried through unchanged.",
    dependsOn: "KB_WRITE_ENABLED",
    effect: "live",
  },
] as const;
