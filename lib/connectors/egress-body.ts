import { scrubReason } from "@/lib/errors/scrub-reason";

const MAX_BODY_BYTES = 256_000;

export type BoundedBodyResult = { ok: true; response: Response } | { ok: false; reason: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: scrubReason(reason) };
}

export async function readBoundedBody(response: Response): Promise<BoundedBodyResult> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return refuse("response body exceeds the size cap");
  }
  if (!response.body) return { ok: true, response };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return refuse("response body exceeds the size cap");
      }
      chunks.push(value);
    }
  } catch (error) {
    return refuse(`failed to read response body: ${message(error)}`);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    ok: true,
    response: new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}
