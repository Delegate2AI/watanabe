import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "@/lib/service/actor";
import type { McpToolDefinition } from "@/lib/service/tool-def";

/**
 * Register a domain's tools on this session's server.
 *
 * The only place in the app that knows both `McpServer` and `McpToolDefinition`.
 * A domain describes its tools as data and never imports the SDK, so widening
 * the surface to the next domain adds an array and one call here rather than
 * another section of `server.ts`.
 *
 * `context` is a thunk, invoked per tool call and never once up front. A session
 * outlives a request: group membership can be revoked and a role taken away
 * while a client is still holding a tool list, and building the actor here would
 * serve that stale answer for the life of the connection. The database handle is
 * resolved on the same schedule for the same reason.
 *
 * The one thing decided at registration is which tools exist, which is how this
 * surface has always worked: a caller never sees a tool it could not call. That
 * filter reads the capability once, so a tool whose `capability` is not `null`
 * can go on being listed after the role behind it is gone. The service re-checks
 * per call, which is what actually refuses the work.
 */
export function registerServiceTools(
  server: McpServer,
  definitions: McpToolDefinition[],
  context: () => ServiceContext,
): void {
  for (const definition of definitions) {
    if (definition.capability !== null && !context().actor.can(definition.capability)) continue;
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      (args: Record<string, unknown>) => definition.handler(context(), args),
    );
  }
}
