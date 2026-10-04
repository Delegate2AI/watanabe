import type { CirclebackTool, CirclebackTransport } from "./circleback";
import {
  circlebackCredentials,
  credentialsExpired,
  refreshCirclebackToken,
  type CirclebackCredentials,
} from "./circleback-auth";

/**
 * Direct MCP transport for Circleback: speaks JSON-RPC over streamable HTTP
 * straight to the server, authenticated with the OAuth access token the
 * Claude Code CLI stored in `$CLAUDE_CONFIG_DIR/.credentials.json`.
 *
 * Exists because the relay-agent transport asks a model to reproduce tool
 * results verbatim, which breaks down on real payloads (a 50KB meeting
 * transcript is a coin flip to survive the round trip) and costs three model
 * calls per meeting. This transport returns the exact bytes the server sent.
 *
 * Token renewal lives in `circleback-auth.ts`. Access tokens last 24 hours, so
 * without it the poll dies a day after every login.
 */

export { circlebackCredentials } from "./circleback-auth";

class CirclebackHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CirclebackHttpError";
  }
}

interface JsonRpcResponse {
  id?: number | string;
  result?: {
    protocolVersion?: string;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

function parseSse(body: string, id: number): JsonRpcResponse | null {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const message = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
      if (message.id === id) return message;
    } catch {
      continue;
    }
  }
  return null;
}

export interface DirectTransportOptions {
  fetchFn?: typeof fetch;
  credentialsPath?: string;
}

export class DirectCirclebackTransport implements CirclebackTransport {
  private sessionId: string | undefined;
  private protocolVersion = "2025-06-18";
  private initialized = false;
  private nextId = 1;

  constructor(private readonly options: DirectTransportOptions = {}) {}

  private get fetchFn(): typeof fetch {
    return this.options.fetchFn ?? fetch;
  }

  private async post(credentials: CirclebackCredentials, payload: object): Promise<Response> {
    return this.fetchFn(credentials.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${credentials.accessToken}`,
        "mcp-protocol-version": this.protocolVersion,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(payload),
    });
  }

  private async rpc(credentials: CirclebackCredentials, method: string, params: object): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const response = await this.post(credentials, { jsonrpc: "2.0", id, method, params });
    if (!response.ok) {
      throw new CirclebackHttpError(response.status, `Circleback MCP ${method} failed: HTTP ${response.status}`);
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    const body = await response.text();
    const message = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      ? parseSse(body, id)
      : (JSON.parse(body) as JsonRpcResponse);
    if (!message) throw new Error(`Circleback MCP ${method} returned no response for request ${id}`);
    if (message.error) throw new Error(`Circleback MCP ${method} error: ${message.error.message}`);
    return message;
  }

  private async ensureInitialized(credentials: CirclebackCredentials): Promise<void> {
    if (this.initialized) return;
    const initResult = await this.rpc(credentials, "initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "watanabe-meetings", version: "1.0.0" },
    });
    if (initResult.result?.protocolVersion) this.protocolVersion = initResult.result.protocolVersion;
    // Fire-and-forget per spec; servers respond 202 with no body.
    await this.post(credentials, { jsonrpc: "2.0", method: "notifications/initialized" });
    this.initialized = true;
  }

  /** A renewed token invalidates the server session, so re-handshake with it. */
  private resetSession(): void {
    this.sessionId = undefined;
    this.initialized = false;
  }

  private async invoke(
    credentials: CirclebackCredentials,
    tool: CirclebackTool,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureInitialized(credentials);
    const message = await this.rpc(credentials, "tools/call", { name: tool, arguments: input });
    const text = message.result?.content?.find((item) => item.type === "text")?.text ?? "";
    if (message.result?.isError) {
      throw new Error(`Circleback ${tool} tool error: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Circleback ${tool} returned non-JSON content: ${text.slice(0, 200)}`);
    }
  }

  async call(tool: CirclebackTool, input: Record<string, unknown>): Promise<unknown> {
    let credentials = circlebackCredentials(this.options.credentialsPath);
    if (!credentials) throw new Error("Circleback MCP credentials not found");

    // A stored expiry means the 401 is knowable in advance; skip the round trip.
    if (credentialsExpired(credentials)) {
      const renewed = await refreshCirclebackToken(credentials, this.fetchFn);
      if (renewed) {
        credentials = renewed;
        this.resetSession();
      }
    }

    try {
      return await this.invoke(credentials, tool, input);
    } catch (error) {
      // The server is the authority on expiry: renew and retry once on a 401,
      // whatever the stored expiry claimed.
      if (!(error instanceof CirclebackHttpError) || error.status !== 401) throw error;
      const renewed = await refreshCirclebackToken(credentials, this.fetchFn);
      if (!renewed) throw error;
      this.resetSession();
      return await this.invoke(renewed, tool, input);
    }
  }
}
