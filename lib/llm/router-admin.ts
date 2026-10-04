import { llmEnv } from "./config";

export class RouterAdminError extends Error {}

export interface RouterAdmin {
  createKey(name: string): Promise<{ id: string; key: string }>;
  deleteKey(id: string): Promise<void>;
}

/** After a refused login, how long the adapter refuses to try again (9router locks out). */
const LOGIN_COOLDOWN_MS = 60_000;

interface CallInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * The only module that knows 9router's dashboard routes. They are undocumented,
 * so the shapes here are pinned by the contract script that runs before any
 * 9router image bump.
 */
export function createRouterAdmin(opts: {
  baseUrl: string;
  password: string;
  fetch?: typeof fetch;
  now?: () => number;
}): RouterAdmin {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const base = opts.baseUrl.replace(/\/+$/, "");
  let cookie: string | null = null;
  let loginBlockedUntil = 0;

  async function send(path: string, init: CallInit): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      throw new RouterAdminError(`9router unreachable: ${(e as Error).message}`);
    }
  }

  let inFlight: Promise<string> | null = null;

  /** Concurrent callers share one login, so a burst of requests is still one attempt against the lockout. */
  function login(): Promise<string> {
    inFlight ??= attemptLogin().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function attemptLogin(): Promise<string> {
    if (now() < loginBlockedUntil) throw new RouterAdminError("9router login is cooling down after a refused login");
    const res = await send("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: opts.password }),
    });
    const token = res.headers
      .getSetCookie()
      .map((c) => /^auth_token=([^;]+)/.exec(c)?.[1])
      .find(Boolean);
    if (!res.ok || !token) {
      loginBlockedUntil = now() + LOGIN_COOLDOWN_MS;
      throw new RouterAdminError(`9router login refused (${res.status})`);
    }
    cookie = `auth_token=${token}`;
    return cookie;
  }

  /** One re-login on a 401 (the session expired), never more: repeated logins trip the lockout. */
  async function call(path: string, init: CallInit): Promise<Response> {
    const first = await send(path, { ...init, headers: { ...init.headers, cookie: cookie ?? (await login()) } });
    if (first.status !== 401) return first;
    cookie = null;
    const retry = await send(path, { ...init, headers: { ...init.headers, cookie: await login() } });
    if (retry.status === 401) throw new RouterAdminError("9router refused the session after a fresh login");
    return retry;
  }

  return {
    async createKey(name) {
      const res = await call("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new RouterAdminError(`9router refused key creation (${res.status})`);
      const body = (await res.json().catch(() => null)) as { id?: unknown; key?: unknown } | null;
      if (typeof body?.id !== "string" || typeof body?.key !== "string" || !body.key) {
        throw new RouterAdminError("9router returned no key");
      }
      return { id: body.id, key: body.key };
    },
    async deleteKey(id) {
      const res = await call(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new RouterAdminError(`9router refused key deletion (${res.status})`);
    },
  };
}

let singleton: { admin: RouterAdmin; url: string; password: string } | null = null;

/** Null when the router URL or admin password is unset; callers answer 503 then. */
export function getRouterAdmin(): RouterAdmin | null {
  const { routerUrl, adminPassword } = llmEnv();
  if (!routerUrl || !adminPassword) return null;
  if (!singleton || singleton.url !== routerUrl || singleton.password !== adminPassword) {
    singleton = {
      admin: createRouterAdmin({ baseUrl: routerUrl, password: adminPassword }),
      url: routerUrl,
      password: adminPassword,
    };
  }
  return singleton.admin;
}
