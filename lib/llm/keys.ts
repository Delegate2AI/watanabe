import type { Database as DatabaseType } from "better-sqlite3";
import { normalizedEmail } from "@/lib/authority/aliases-store";
import { getLlmKey, insertLlmKey, revokeLlmKey, type LlmKey } from "@/lib/db/llm-keys";
import { log } from "@/lib/log";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { ensureDefaultGroup } from "./defaults";
import { notifyGate } from "./gate-client";
import type { RouterAdmin } from "./router-admin";

const MAX_LABEL = 60;

interface KeyDeps {
  db: DatabaseType;
  admin: RouterAdmin | null;
  notify?: () => Promise<void>;
}

/**
 * The raw key is returned here once and never stored; a failed 9router call
 * writes no row. With no model groups configured yet, the default group is
 * created so the key works at once. The gate is told at once so the key works
 * without waiting for its next snapshot pull.
 */
export async function createLlmKey(
  deps: KeyDeps,
  input: { ownerEmail: string; label: string },
): Promise<ServiceResult<{ key: string; record: LlmKey }>> {
  const owner = normalizedEmail(input.ownerEmail);
  const label = input.label.trim();
  if (!label || label.length > MAX_LABEL) return err("invalid_request", { detail: "label" });
  if (!deps.admin) return err("llm_unavailable", { message: "LLM_ROUTER_URL or NINEROUTER_ADMIN_PASSWORD unset" });

  let created: { id: string; key: string };
  try {
    created = await deps.admin.createKey(`${owner} ${label}`);
  } catch (e) {
    log.warn("llm key creation refused by 9router", { owner, error: (e as Error).message });
    return err("llm_unavailable");
  }

  let record: LlmKey;
  try {
    record = insertLlmKey(deps.db, { ownerEmail: owner, routerKeyId: created.id, key: created.key, label });
  } catch (e) {
    log.error("llm key row insert failed; deleting the 9router key", { owner, error: (e as Error).message });
    await deps.admin.deleteKey(created.id).catch(() => undefined);
    return err("internal");
  }
  try {
    if (ensureDefaultGroup(deps.db)) log.info("llm default model group created with the first key", { owner });
  } catch (e) {
    log.warn("llm default model group could not be created", { error: (e as Error).message });
  }
  await (deps.notify ?? notifyGate)();
  return ok({ key: created.key, record });
}

/**
 * The row is revoked first, so a 9router outage cannot leave the key working at
 * the gate (plan decision A5). `ownerEmail: null` is the admin scope.
 */
export async function revokeLlmKeyFor(
  deps: KeyDeps,
  input: { id: string; ownerEmail: string | null },
): Promise<ServiceResult<null>> {
  const key = getLlmKey(deps.db, input.id);
  const owner = input.ownerEmail === null ? null : normalizedEmail(input.ownerEmail);
  if (!key || (owner !== null && key.ownerEmail !== owner)) return err("not_found");
  if (key.status === "revoked") return ok(null);

  revokeLlmKey(deps.db, key.id);
  try {
    if (deps.admin) await deps.admin.deleteKey(key.routerKeyId);
    else log.warn("llm key revoked here but 9router is not configured, so it was not deleted there", { id: key.id });
  } catch (e) {
    log.warn("llm key revoked here but not deleted in 9router", { id: key.id, error: (e as Error).message });
  }
  await (deps.notify ?? notifyGate)();
  return ok(null);
}
