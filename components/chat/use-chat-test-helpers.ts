import type { AgentEvent } from "@/lib/agent/events";

/** Build a Response whose body streams the given events as one NDJSON line each. */
export function ndjsonResponse(events: AgentEvent[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status });
}
