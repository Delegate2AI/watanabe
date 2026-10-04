// Checks that a 9router build still speaks the dashboard API the portal relies
// on (lib/llm/router-admin.ts). Run before bumping the 9router image; see README.
//
//   ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=... node scripts/llm-gate/contract.mjs
//
// Creates one key named `contract-check`, then deletes it. Exits non-zero on the
// first mismatch.

const base = (process.env.ROUTER_URL ?? "http://127.0.0.1:20128").replace(/\/+$/, "");
const password = process.env.ROUTER_PASSWORD;
if (!password) {
  console.error("ROUTER_PASSWORD is required");
  process.exit(2);
}

let failed = false;
function check(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
  return ok;
}

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
const token = login.headers
  .getSetCookie()
  .map((c) => /^auth_token=([^;]+)/.exec(c)?.[1])
  .find(Boolean);
check(login.ok, "POST /api/auth/login succeeds", String(login.status));
if (!check(!!token, "login sets an auth_token cookie", login.headers.getSetCookie().map((c) => c.split("=")[0]).join(","))) {
  process.exit(1);
}
const cookie = `auth_token=${token}`;

const created = await fetch(`${base}/api/keys`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ name: "contract-check" }),
});
const body = await created.json().catch(() => null);
check(created.status === 201 || created.ok, "POST /api/keys creates a key", String(created.status));
check(typeof body?.id === "string" && body.id.length > 0, "create returns a string id");
check(typeof body?.key === "string" && body.key.length > 8, "create returns the full key once");

const unauth = await fetch(`${base}/api/keys`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "contract-check-unauth" }),
});
check(unauth.status === 401 || unauth.status === 403, "POST /api/keys without the cookie is refused", String(unauth.status));

if (typeof body?.id === "string") {
  const del = await fetch(`${base}/api/keys/${encodeURIComponent(body.id)}`, { method: "DELETE", headers: { cookie } });
  check(del.ok, "DELETE /api/keys/:id deletes it", String(del.status));
  const again = await fetch(`${base}/api/keys/${encodeURIComponent(body.id)}`, { method: "DELETE", headers: { cookie } });
  check(again.ok || again.status === 404, "deleting it again is ok or 404", String(again.status));
}

process.exit(failed ? 1 : 0);
