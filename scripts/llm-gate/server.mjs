import { once } from "node:events";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { modelMatches } from "./match.mjs";
import { hashKey } from "./state.mjs";
import { UsageTap } from "./usage.mjs";

export const SECRET_HEADER = "x-llm-gate-secret";
const MAX_BODY_BYTES = 50 * 1024 * 1024;

const ROUTES = {
  "/v1/messages": { method: "POST", charge: true },
  "/v1/messages/count_tokens": { method: "POST", charge: false },
  "/v1/chat/completions": { method: "POST", charge: true },
  "/v1/embeddings": { method: "POST", charge: true },
  "/v1/models": { method: "GET", charge: false },
};

/** Never forwarded up: hop-by-hop, and `accept-encoding` so the usage tap reads plain text. */
const DROP_REQUEST = new Set([
  "host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer",
  "proxy-authorization", "proxy-connection", SECRET_HEADER,
]);
/** Never passed back: the body is re-chunked by this server. */
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

const ANTHROPIC_TYPES = {
  400: "invalid_request_error", 401: "authentication_error", 403: "permission_error", 404: "not_found_error",
  413: "request_too_large", 429: "rate_limit_error", 502: "api_error", 503: "api_error",
};

function sameSecret(provided, secret) {
  const a = Buffer.from(provided ?? "", "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function callerKey(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim() || null;
  const apiKey = req.headers["x-api-key"];
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

/** Errors in the caller's own format, so a harness shows the message rather than a parse failure. */
function sendError(res, path, status, message, extraHeaders = {}) {
  const anthropic = path.startsWith("/v1/messages");
  const body = anthropic
    ? { type: "error", error: { type: ANTHROPIC_TYPES[status] ?? "api_error", message } }
    : { error: { message, type: ANTHROPIC_TYPES[status] ?? "api_error", code: status } };
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function refusal(check, helpUrl, now) {
  const help = helpUrl ? ` See ${helpUrl}.` : "";
  if (check.status === 401) return { message: "Invalid or revoked API key." };
  if (check.status === 403) return { message: `Model "${check.model}" is not available to you.${help}` };
  if (check.status === 429) {
    const seconds = Math.max(1, Math.ceil((Date.parse(check.resetAt) - now) / 1000));
    return {
      message: `Your token budget for "${check.groupSlug}" is used up until ${check.resetAt}. Request more in watanabe.${help}`,
      headers: { "retry-after": String(seconds) },
    };
  }
  return { message: "The LLM gateway is not ready. Try again shortly." };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(req, bodyLength) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!DROP_REQUEST.has(name) && typeof value === "string") headers[name] = value;
  }
  headers["accept-encoding"] = "identity";
  if (bodyLength !== null) headers["content-length"] = String(bodyLength);
  return headers;
}

/**
 * The gate's HTTP surface. Checks key, model and budget against `state`, then
 * streams the request to 9router with the caller's key unchanged and records
 * the usage it reads on the way back. Never logs a key.
 */
export function createGateServer({ state, routerUrl, secret, helpUrl = null, onInvalidate = () => {}, now = Date.now, fetchImpl = fetch, log = console }) {
  const base = routerUrl.replace(/\/+$/, "");

  async function handleModels(req, res, path, check) {
    let upstream;
    try {
      upstream = await fetchImpl(`${base}${path}`, { headers: upstreamHeaders(req, null) });
    } catch {
      return sendError(res, path, 502, "The LLM gateway could not reach its router.");
    }
    const text = await upstream.text();
    if (!upstream.ok) {
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      return res.end(text);
    }
    const patterns = state.allowedGroups(check.key.ownerEmail).flatMap((g) => g.models);
    try {
      const body = JSON.parse(text);
      if (Array.isArray(body.data)) body.data = body.data.filter((m) => patterns.some((p) => modelMatches(p, String(m.id))));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    } catch {
      sendError(res, path, 502, "The router returned a model list the gateway could not read.");
    }
  }

  async function handleProxy(req, res, path, route) {
    // The key first: this route is public, so nobody without one gets the gate
    // to buffer and parse a body. Node discards an unread body as a stream.
    const key = callerKey(req);
    const keyHash = key ? hashKey(key) : null;
    const admitted = keyHash ? state.check(keyHash, null, now()) : { ok: false, status: 401 };
    if (!admitted.ok) return sendError(res, path, admitted.status, refusal(admitted, helpUrl, now()).message);

    const raw = await readBody(req);
    if (raw === null) return sendError(res, path, 413, "Request body too large.");
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return sendError(res, path, 400, "Request body must be JSON.");
    }
    const model = typeof body?.model === "string" ? body.model : null;
    if (!model) return sendError(res, path, 400, "Request names no model.");

    const check = state.check(keyHash, model, now());
    if (!check.ok) {
      const { message, headers } = refusal(check, helpUrl, now());
      return sendError(res, path, check.status, message, headers);
    }

    let payload = raw;
    if (path === "/v1/chat/completions" && body.stream === true && body.stream_options?.include_usage !== true) {
      body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
      payload = Buffer.from(JSON.stringify(body), "utf8");
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    let upstream;
    try {
      upstream = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: upstreamHeaders(req, payload.length),
        body: payload,
        signal: abort.signal,
      });
    } catch {
      if (!res.headersSent && !abort.signal.aborted) sendError(res, path, 502, "The LLM gateway could not reach its router.");
      return;
    }

    const headers = {};
    upstream.headers.forEach((value, name) => {
      if (!DROP_RESPONSE.has(name)) headers[name] = value;
    });
    res.writeHead(upstream.status, headers);

    const charge = route.charge && upstream.ok;
    const tap = charge ? new UsageTap(upstream.headers.get("content-type")) : null;
    const decoder = new TextDecoder();
    try {
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          tap?.push(decoder.decode(chunk, { stream: true }));
          if (!res.write(chunk) && !res.destroyed) await once(res, "drain");
        }
      }
    } catch {
      // Client went away or the upstream stream broke: charge what was seen.
    } finally {
      res.end();
      if (charge) {
        const seen = tap.end();
        const usage = seen.seen ? seen : { inputTokens: Math.ceil(raw.length / 4), outputTokens: 0, cacheReadTokens: 0 };
        state.record({ check, model, usage, now: now() });
        log.info?.(`llm-gate ${path} ${upstream.status} owner=${check.key.ownerEmail} in=${usage.inputTokens} out=${usage.outputTokens}${seen.seen ? "" : " estimated"}`);
      }
    }
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://gate").pathname;
    try {
      if (path === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("ok");
      }
      if (path === "/invalidate" && req.method === "POST") {
        if (!secret) return void res.writeHead(501).end();
        if (!sameSecret(req.headers[SECRET_HEADER], secret)) return void res.writeHead(401).end();
        onInvalidate();
        return void res.writeHead(204).end();
      }
      const route = ROUTES[path];
      if (!route || req.method !== route.method) return sendError(res, path, 404, "Not found.");

      if (route.method === "GET") {
        const key = callerKey(req);
        const check = key ? state.check(hashKey(key), null, now()) : { ok: false, status: 401 };
        if (!check.ok) return sendError(res, path, check.status, refusal(check, helpUrl, now()).message);
        return await handleModels(req, res, path, check);
      }
      return await handleProxy(req, res, path, route);
    } catch (e) {
      log.error?.(`llm-gate ${path} failed: ${e?.message ?? e}`);
      if (!res.headersSent) sendError(res, path, 502, "The LLM gateway failed to handle this request.");
      else res.end();
    }
  });
}
