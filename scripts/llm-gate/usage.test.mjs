import { describe, expect, it } from "vitest";
import { UsageTap } from "./usage.mjs";

function sse(events) {
  return events.map((e) => (typeof e === "string" ? `data: ${e}\n\n` : `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)).join("");
}

function tap(contentType, chunks) {
  const t = new UsageTap(contentType);
  for (const c of chunks) t.push(c);
  return t.end();
}

describe("UsageTap", () => {
  it("reads an Anthropic JSON reply, counting cache creation as input and excluding cache reads", () => {
    const body = JSON.stringify({
      type: "message",
      usage: { input_tokens: 12, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 40 },
    });
    expect(tap("application/json", [body])).toEqual({ seen: true, inputTokens: 112, outputTokens: 40, cacheReadTokens: 5000 });
  });

  it("reads an Anthropic stream: input from message_start, output from the last cumulative message_delta", () => {
    const stream = sse([
      { type: "message_start", message: { usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { text: "hi" } },
      { type: "message_delta", usage: { output_tokens: 10 } },
      { type: "message_delta", usage: { output_tokens: 25 } },
      { type: "message_stop" },
    ]);
    expect(tap("text/event-stream", [stream])).toEqual({ seen: true, inputTokens: 30, outputTokens: 25, cacheReadTokens: 900 });
  });

  it("survives an event split across chunks and CRLF line endings", () => {
    const stream = sse([{ type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 1 } } }]).replace(/\n/g, "\r\n");
    const mid = Math.floor(stream.length / 2);
    expect(tap("text/event-stream; charset=utf-8", [stream.slice(0, mid), stream.slice(mid)])).toMatchObject({ seen: true, inputTokens: 7 });
  });

  it("keeps what a cut Anthropic stream had already reported", () => {
    const stream = sse([{ type: "message_start", message: { usage: { input_tokens: 50, output_tokens: 1 } } }]);
    expect(tap("text/event-stream", [stream])).toEqual({ seen: true, inputTokens: 50, outputTokens: 1, cacheReadTokens: 0 });
  });

  it("reads an OpenAI JSON reply, taking cached prompt tokens out of input", () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } } });
    expect(tap("application/json", [body])).toEqual({ seen: true, inputTokens: 20, outputTokens: 30, cacheReadTokens: 100 });
  });

  it("reads the usage chunk at the end of an OpenAI stream and ignores [DONE]", () => {
    const stream = sse([
      JSON.stringify({ choices: [{ delta: { content: "a" } }], usage: null }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }),
      "[DONE]",
    ]);
    expect(tap("text/event-stream", [stream])).toEqual({ seen: true, inputTokens: 9, outputTokens: 4, cacheReadTokens: 0 });
  });

  it("reads embeddings usage", () => {
    expect(tap("application/json", [JSON.stringify({ usage: { prompt_tokens: 8, total_tokens: 8 } })])).toMatchObject({ seen: true, inputTokens: 8, outputTokens: 0 });
  });

  it("reports nothing seen for a stream with no usage or a body that is not JSON", () => {
    expect(tap("text/event-stream", [sse([JSON.stringify({ choices: [] })])]).seen).toBe(false);
    expect(tap("application/json", ["not json"]).seen).toBe(false);
  });
});
