import { NextResponse } from "next/server";
import { agentAuthMode, resolveAgentEnv } from "@/lib/agent/auth";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { vaultExists } from "@/lib/repo";

/**
 * READINESS probe — distinct from the static LIVENESS probe at `/api/health`.
 *
 * `/api/health` deliberately imports nothing and always returns `{status:"ok"}`;
 * it only proves the process is alive (catches a hung event loop). It cannot
 * tell you the pod can actually *serve*: the KB vault may be missing, the
 * SQLite thread-ownership PVC may be full/read-only, or the Anthropic
 * credential may be absent. This route checks all three so a kubelet
 * readinessProbe can pull an unable-to-serve pod out of rotation.
 *
 * Unauthenticated by design — the kubelet has no SSO headers, so this must not
 * depend on identity. It exposes only booleans (never the credential value, a
 * DB path, or any content), so there is nothing sensitive to gate.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * KB present: the vault root (`vaultRoot()`, `docs/` inside the checkout by
 * default) resolves AND is non-empty — `vaultExists()` already requires both,
 * so this is a thin wrapper kept for naming symmetry with `dbOk`/`credentialOk`.
 */
function docsOk(): boolean {
  return vaultExists();
}

/**
 * DB writable: the real failure mode is a full or read-only PVC, so a pure read
 * pragma is not enough — we prove *writability*. We insert then immediately
 * delete a throwaway row in a dedicated `_readycheck` scratch table, never
 * touching the real `threads` table. On a read-only/full DB the INSERT throws
 * ("attempt to write a readonly database" / "disk full"), which is exactly the
 * condition we want to surface. Reuses the process-wide connection from
 * `getDb()` so we don't open a second handle or fight its WAL.
 */
function dbOk(): boolean {
  try {
    const db = getDb();
    db.exec(
      "CREATE TABLE IF NOT EXISTS _readycheck (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL)",
    );
    const info = db.prepare("INSERT INTO _readycheck (ts) VALUES (?)").run(new Date().toISOString());
    db.prepare("DELETE FROM _readycheck WHERE id = ?").run(info.lastInsertRowid);
    return true;
  } catch {
    return false;
  }
}

/**
 * Credential present: reuse the app's own `resolveAgentEnv()` so we check the
 * exact same requirement the Agent SDK will hit. It returns `undefined` for a
 * local deploy (rides the ambient Claude Code login — no credential needed) and
 * throws only when this is a remote deploy (`AGENT_CHAT_REMOTE`/a token/a key
 * present) that is missing `AGENT_CHAT_OAUTH_TOKEN`/`AGENT_CHAT_API_KEY`. We
 * discard the returned env — presence only, the value is never read or logged.
 */
function credentialOk(): boolean {
  try {
    resolveAgentEnv();
    return true;
  } catch {
    return false;
  }
}

export function GET(): Response {
  const checks = {
    docs: docsOk(),
    db: dbOk(),
    credential: credentialOk(),
  };

  // Non-secret label of which credential path resolved (a mode name, never the
  // token/key/path). Lets an operator confirm local runs are on the Claude Code
  // subscription rather than silently metering a stray API key.
  const agentAuth = agentAuthMode();

  const failed = (Object.keys(checks) as (keyof typeof checks)[]).filter((k) => !checks[k]);

  if (failed.length > 0) {
    log.warn("readiness check failed", { failed });
    return NextResponse.json({ ready: false, checks, agentAuth, failed }, { status: 503 });
  }

  return NextResponse.json({ ready: true, agentAuth });
}
