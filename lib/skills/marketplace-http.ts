/**
 * The transport half of the marketplace index (spec 34): get the bytes, or a
 * reason, from a remote we do not control.
 *
 * A marketplace index is untrusted input arriving over the network, so every
 * dimension of it is bounded here before a parser ever sees it:
 *
 * - **Scheme allow-list.** Only http(s) is fetched. `file://` and `data:` would
 *   turn a config typo (or a compromised config) into a local file read.
 * - **A deadline, not just a signal.** The abort signal is handed to `fetch` AND
 *   the whole call is raced against a timer. A signal alone only binds a client
 *   that honors it; the race binds the call itself, headers and body alike. The
 *   connectors connection-test route learned this the hard way: a signal passed
 *   into a client that ignored it during the handshake hung the route forever.
 * - **A body cap enforced while reading.** `content-length` is checked first as
 *   a cheap refusal, but it is a claim by the remote, so the streamed read is
 *   capped too and stops the moment the cap is passed. A marketplace serving a
 *   500MB chunked body never gets buffered.
 *
 * Never throws: every failure is `{ ok: false, reason }`.
 */

/** Whole-request budget: headers, body, and any redirects in between. */
export const MARKETPLACE_TIMEOUT_MS = 5_000;

/** A curated index of a few hundred entries is kilobytes. 1MB is already generous. */
export const MAX_INDEX_BYTES = 1_000_000;

export type IndexFetchResult = { ok: true; text: string } | { ok: false; reason: string };

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * A parseable http(s) URL, and nothing else. The single definition of that test
 * for the whole marketplace: the index URL uses it below, and the `url` of an
 * index ENTRY uses it too, since neither may name a scheme that reads something
 * server-local (`file://`, an absolute path) or a pseudo-scheme (`javascript:`,
 * `data:`).
 */
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** http(s) only, and a parseable URL: anything else never reaches `fetch`. */
export function checkIndexUrl(indexUrl: string): { ok: true; value: string } | { ok: false; reason: string } {
  const value = indexUrl.trim();
  if (value === "") return { ok: false, reason: "marketplace index URL is empty" };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: `marketplace index URL is not a URL: "${value.slice(0, 200)}"` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `marketplace index URL must be http or https, got "${parsed.protocol}"` };
  }
  return { ok: true, value };
}

export async function fetchIndexText(
  indexUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = MARKETPLACE_TIMEOUT_MS,
): Promise<IndexFetchResult> {
  const url = checkIndexUrl(indexUrl);
  if (!url.ok) return url;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<IndexFetchResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: `marketplace index request timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(url.value, fetchImpl, controller.signal), deadline]);
  } catch (error) {
    return { ok: false, reason: `marketplace index request failed: ${message(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How many hops a marketplace index may redirect through. Enough for the usual
 * `http -> https` and apex-to-www pair, and nowhere near enough to walk a chain.
 */
export const MAX_INDEX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Follow redirects by hand, re-checking every hop.
 *
 * `redirect: "follow"` applies the scheme allow-list to the FIRST url only, so
 * a configured index that is compromised (or simply moved onto a host that is)
 * could 302 the request onto any other URL and have the result read, parsed,
 * and reported. Resolving each `Location` against the current URL and putting it
 * back through `checkIndexUrl` is what makes the allow-list apply to the whole
 * chain rather than to the configuration alone.
 */
async function request(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<IndexFetchResult> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        signal,
        redirect: "manual",
        headers: { accept: "application/json" },
      });
    } catch (error) {
      return { ok: false, reason: `marketplace index request failed: ${message(error)}` };
    }

    if (!REDIRECT_STATUSES.has(response.status)) return await read(response);

    if (hop >= MAX_INDEX_REDIRECTS) {
      return { ok: false, reason: `marketplace index redirected more than ${MAX_INDEX_REDIRECTS} times` };
    }
    const location = response.headers.get("location");
    if (location === null) {
      return { ok: false, reason: "marketplace index redirected without a location" };
    }
    let target: string;
    try {
      target = new URL(location, current).toString();
    } catch {
      return { ok: false, reason: "marketplace index redirected to an unusable location" };
    }
    const checked = checkIndexUrl(target);
    // The refused URL is deliberately not echoed: it is chosen by the remote.
    if (!checked.ok) return { ok: false, reason: "marketplace index redirected to a URL that is not allowed" };
    current = checked.value;
  }
}

async function read(response: Response): Promise<IndexFetchResult> {
  if (!response.ok) {
    return { ok: false, reason: `marketplace index request failed: HTTP ${response.status}` };
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INDEX_BYTES) {
    return { ok: false, reason: tooLarge(declared) };
  }

  return readCapped(response);
}

/**
 * Read the body a chunk at a time and stop the moment the cap is passed, so a
 * body that lies about (or omits) its length still cannot be buffered whole.
 */
async function readCapped(response: Response): Promise<IndexFetchResult> {
  const body = response.body;
  if (body === null) {
    try {
      const text = await response.text();
      const size = Buffer.byteLength(text, "utf8");
      return size > MAX_INDEX_BYTES ? { ok: false, reason: tooLarge(size) } : { ok: true, text };
    } catch (error) {
      return { ok: false, reason: `marketplace index body could not be read: ${message(error)}` };
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_INDEX_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: tooLarge(total) };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false, reason: `marketplace index body could not be read: ${message(error)}` };
  }

  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

function tooLarge(size: number): string {
  return `marketplace index is too large: ${size} bytes read, cap is ${MAX_INDEX_BYTES}`;
}
