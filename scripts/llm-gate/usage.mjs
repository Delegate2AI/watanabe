/** A non-streamed body larger than this is passed through but not parsed. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Reads token usage out of a 9router reply as it streams past, in either the
 * Anthropic or the OpenAI shape (told apart by the usage object's own keys, so
 * a translated reply is read correctly whichever path it came in on).
 *
 * Anthropic: input from `message_start`, then every field last-wins from
 * `message_delta`, whose counts are cumulative (plan decision B5). Cache
 * creation counts as input; cache reads are recorded but never charged (B4).
 * OpenAI: `prompt_tokens` includes cached tokens, which are taken out.
 */
export class UsageTap {
  #stream;
  #buffer = "";
  #bytes = 0;
  #seen = false;
  #input = 0;
  #cacheCreation = 0;
  #cacheRead = 0;
  #output = 0;

  constructor(contentType) {
    this.#stream = /text\/event-stream/i.test(contentType ?? "");
  }

  push(text) {
    if (this.#stream) {
      this.#buffer += text;
      const lines = this.#buffer.split("\n");
      this.#buffer = lines.pop() ?? "";
      for (const line of lines) this.#line(line.replace(/\r$/, ""));
      return;
    }
    this.#bytes += text.length;
    if (this.#bytes <= MAX_JSON_BYTES) this.#buffer += text;
  }

  end() {
    if (this.#stream) {
      if (this.#buffer) this.#line(this.#buffer.replace(/\r$/, ""));
    } else if (this.#bytes <= MAX_JSON_BYTES) {
      try {
        this.#absorb(JSON.parse(this.#buffer)?.usage);
      } catch {
        // Not JSON (an upstream error page, say): nothing to count.
      }
    }
    this.#buffer = "";
    return {
      seen: this.#seen,
      inputTokens: this.#input + this.#cacheCreation,
      outputTokens: this.#output,
      cacheReadTokens: this.#cacheRead,
    };
  }

  #line(line) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event?.type === "message_start") this.#absorb(event.message?.usage);
    else this.#absorb(event?.usage);
  }

  #absorb(usage) {
    if (!usage || typeof usage !== "object") return;
    if ("prompt_tokens" in usage || "completion_tokens" in usage) {
      const cached = num(usage.prompt_tokens_details?.cached_tokens) ?? 0;
      const prompt = num(usage.prompt_tokens) ?? 0;
      this.#input = Math.max(0, prompt - cached);
      this.#cacheRead = cached;
      this.#cacheCreation = 0;
      this.#output = num(usage.completion_tokens) ?? 0;
      this.#seen = true;
      return;
    }
    const fields = [
      ["input_tokens", (v) => (this.#input = v)],
      ["cache_creation_input_tokens", (v) => (this.#cacheCreation = v)],
      ["cache_read_input_tokens", (v) => (this.#cacheRead = v)],
      ["output_tokens", (v) => (this.#output = v)],
    ];
    for (const [name, set] of fields) {
      const v = num(usage[name]);
      if (v !== null) {
        set(v);
        this.#seen = true;
      }
    }
  }
}
