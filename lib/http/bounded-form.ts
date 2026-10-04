/**
 * Multipart parsing that stops at a byte limit instead of after it.
 *
 * `Request.formData()` materializes the whole body before anything can look at
 * a file's size, and a chunked upload declares no `content-length` to check
 * beforehand, so counting the bytes as they arrive is the only bound on it.
 */

/** Thrown past the limit, so callers can answer 413 rather than 400. */
export class BodyTooLarge extends RangeError {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "BodyTooLarge";
  }
}

/**
 * Parse `request` as multipart, refusing it once it passes `limit` bytes.
 * Throws `BodyTooLarge` past the limit, and whatever the parser throws for a
 * body that is not valid multipart.
 *
 * Past the limit the rest of the body is read and discarded rather than
 * cancelled: memory stays bounded either way, and cancelling a request stream
 * mid-flight leaves the sender's own producer erroring into a closed stream.
 */
export async function boundedFormData(request: Request, limit: number): Promise<FormData> {
  const body = request.body;
  if (body === null) return request.formData();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let overflowed = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > limit) {
      overflowed = true;
      continue;
    }
    chunks.push(value);
  }
  if (overflowed) throw new BodyTooLarge(limit);

  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
