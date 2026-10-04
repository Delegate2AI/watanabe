import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

export type ContentServerContext = object;

export const createContentMcpServer: (context: ContentServerContext) => ReturnType<typeof createSdkMcpServer> = () =>
  createSdkMcpServer({ name: "content", version: "1.0.0", tools: [] });
