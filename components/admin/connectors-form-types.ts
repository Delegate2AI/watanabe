import type { ConnectorIcon } from "./connectors-meta-fields";
import type { AuthMode } from "./connectors-oauth-fields";

export interface ConnectorEnvVar {
  name: string;
  present: boolean;
}

export interface ConnectorRow {
  slug: string;
  status: "ok" | "disabled";
  reason?: string;
  title?: string;
  transport?: "http" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  groups?: string[];
  tools?: string[];
  description?: string;
  icon?: ConnectorIcon;
  auth?: "oauth";
  oauthClientId?: string;
  authOrigins?: string[];
  envVars: ConnectorEnvVar[];
}

export interface ConnectorEntryInput {
  title: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  groups: string[];
  tools?: string[];
  description?: string;
  icon?: ConnectorIcon;
  auth?: "oauth";
  oauthClientId?: string;
  oauthClientSecret?: string;
  authOrigins?: string[];
}

export interface FormValues {
  slug: string;
  title: string;
  transport: "http" | "sse" | "stdio";
  url: string;
  headers: string;
  command: string;
  args: string;
  env: string;
  groups: string[];
  tools: string;
  description: string;
  icon: ConnectorIcon | "";
  auth: AuthMode;
  oauthClientId: string;
  oauthClientSecret: string;
  authOrigins: string;
}
