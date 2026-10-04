import type { Agent } from "undici";
import { scrubReason } from "@/lib/errors/scrub-reason";
import { readBoundedBody } from "./egress-body";
import { createPinnedDispatcher } from "./egress-dispatcher";
import {
  classifyAddress,
  defaultResolve,
  isIpLiteralHost,
  isLocalDevException,
  stripBrackets,
  type ResolveFn,
} from "./egress-net";
import { applyRedirectMethodRules, classifyRedirectStatus } from "./egress-redirect";

export type EgressOptions = {
  resolve?: ResolveFn;
  approvedOrigins?: string[];
};

export type EgressCheckResult = { ok: true; url: URL } | { ok: false; reason: string };

export type FetchEgressOptions = EgressOptions & {
  fetchImpl?: typeof fetch;
};

export type FetchEgressResult = { ok: true; response: Response } | { ok: false; reason: string };

type PinnedRequestInit = RequestInit & { dispatcher: Agent };

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function causeMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return causeMessage(error.cause);
  return message(error);
}

function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: scrubReason(reason) };
}

function normalizeUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    url.hostname = url.hostname.replace(/\.+$/, "");
    return url;
  } catch {
    return null;
  }
}

export async function checkEgressUrl(url: string, opts: EgressOptions = {}): Promise<EgressCheckResult> {
  const resolve = opts.resolve ?? defaultResolve;
  const parsed = normalizeUrl(url);
  if (!parsed) return refuse("not a valid absolute url");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return refuse("only http and https urls are supported");
  }

  const localDevException = isLocalDevException(parsed.hostname);
  if (parsed.protocol === "http:" && !localDevException) {
    return refuse("http requests are refused, only https is allowed");
  }

  if (isIpLiteralHost(parsed.hostname)) {
    const verdict = classifyAddress(stripBrackets(parsed.hostname));
    if (verdict.blocked && !(localDevException && verdict.reason.includes("loopback"))) {
      return refuse(verdict.reason);
    }
    return { ok: true, url: parsed };
  }

  let addresses: { address: string }[];
  try {
    addresses = await resolve(parsed.hostname, { all: true });
  } catch (error) {
    return refuse(`could not resolve host: ${message(error)}`);
  }
  if (addresses.length === 0) return refuse("host did not resolve to any address");

  for (const { address } of addresses) {
    const verdict = classifyAddress(address);
    if (verdict.blocked && !(localDevException && verdict.reason.includes("loopback"))) {
      return refuse(verdict.reason);
    }
  }

  return { ok: true, url: parsed };
}

function hasAuthorizationHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("authorization");
  if (Array.isArray(headers)) return headers.some(([key]) => key.toLowerCase() === "authorization");
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

export async function fetchEgress(
  url: string,
  init: RequestInit = {},
  opts: FetchEgressOptions = {},
): Promise<FetchEgressResult> {
  const resolve = opts.resolve ?? defaultResolve;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const approvedOrigins = opts.approvedOrigins ?? [];
  const carriesCredential = hasAuthorizationHeader(init.headers);

  const initial = await checkEgressUrl(url, { resolve });
  if (!initial.ok) return initial;

  let current = initial.url;
  const originOrigin = current.origin;
  const hopInit: RequestInit = { ...init };
  const chainSignal = AbortSignal.timeout(TIMEOUT_MS);
  const dispatcher = createPinnedDispatcher(resolve);
  let hop = 0;

  try {
    while (true) {
      let response: Response;
      try {
        const requestInit: PinnedRequestInit = {
          ...hopInit,
          redirect: "manual",
          signal: chainSignal,
          dispatcher,
        };
        response = await fetchImpl(current.toString(), requestInit);
      } catch (error) {
        return refuse(`egress request failed: ${causeMessage(error)}`);
      }

      const redirectKind = classifyRedirectStatus(response.status);
      if (!redirectKind) return readBoundedBody(response);

      hop += 1;
      if (hop > MAX_REDIRECTS) return refuse("refused after too many redirects");

      const location = response.headers.get("location");
      if (!location) return refuse("redirect carried no location header");

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return refuse("redirect location is not a valid url");
      }

      const checked = await checkEgressUrl(next.toString(), { resolve });
      if (!checked.ok) return checked;

      const crossOrigin = checked.url.origin !== originOrigin;
      if (carriesCredential && crossOrigin) {
        return refuse("refusing to follow a credential bearing redirect across an origin change");
      }
      if (crossOrigin && !approvedOrigins.includes(checked.url.origin)) {
        return refuse("redirect target origin is not in the approved origin list");
      }

      applyRedirectMethodRules(hopInit, redirectKind);
      current = checked.url;
    }
  } finally {
    await dispatcher.close().catch(() => {});
  }
}
