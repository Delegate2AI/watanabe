/** Client-safe NDJSON stream reader. Yields one parsed object per line. */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<T, void, void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            yield JSON.parse(line) as T;
          } catch {
            /* skip malformed line */
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail) as T;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}
