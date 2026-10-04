import { createHash } from "node:crypto";
import { groupForModel } from "./match.mjs";

/** Past this age the snapshot is not trusted: a long portal outage must never mean unlimited budgets. */
export const STALE_MS = 10 * 60 * 1000;

export function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function deltaKey(d) {
  return `${d.ownerEmail}|${d.groupSlug}|${d.model}|${d.periodStart}|${d.day}`;
}

function addInto(map, d) {
  const key = deltaKey(d);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { ...d });
    return;
  }
  prev.inputTokens += d.inputTokens;
  prev.outputTokens += d.outputTokens;
  prev.cacheReadTokens += d.cacheReadTokens;
  prev.requests += d.requests;
}

/**
 * What the gate knows between portal syncs: the last snapshot, usage not yet
 * sent (pending), and usage sent but not yet visible in a snapshot
 * (unconfirmed, plan decision B6). Remaining budget subtracts both.
 */
export class GateState {
  snapshot = null;
  fetchedAt = 0;
  disabled = false;
  #keys = new Map();
  #budgets = new Map();
  #pending = new Map();
  #touched = new Map();
  #unconfirmed = [];

  /** `fetchStartedAt` is the gate's clock when the pull began, so a flush after it is not yet included. */
  applySnapshot(snapshot, fetchStartedAt) {
    this.snapshot = snapshot;
    this.fetchedAt = fetchStartedAt;
    this.disabled = false;
    this.#keys = new Map(snapshot.keys.map((k) => [k.hash, k]));
    this.#budgets = new Map(snapshot.budgets.map((b) => [`${b.ownerEmail}|${b.groupSlug}`, b]));
    this.#unconfirmed = this.#unconfirmed.filter((u) => u.at >= fetchStartedAt);
  }

  /** The portal answered 404: the feature flag is off. */
  markDisabled() {
    this.disabled = true;
  }

  usable(now) {
    return !!this.snapshot && !this.disabled && now - this.fetchedAt <= STALE_MS;
  }

  #inFlight(ownerEmail, groupSlug, periodStart) {
    const matches = (d) => d.ownerEmail === ownerEmail && d.groupSlug === groupSlug && d.periodStart === periodStart;
    let total = 0;
    for (const d of this.#pending.values()) if (matches(d)) total += d.inputTokens + d.outputTokens;
    for (const u of this.#unconfirmed) {
      for (const d of u.deltas) if (matches(d)) total += d.inputTokens + d.outputTokens;
    }
    return total;
  }

  /** The model groups this owner may call, for filtering `/v1/models`. */
  allowedGroups(ownerEmail) {
    if (!this.snapshot) return [];
    return this.snapshot.groups.filter((g) => this.#budgets.get(`${ownerEmail}|${g.slug}`)?.allowed);
  }

  /**
   * `model` null checks the key only. Results carry what the server needs to
   * answer: a status and reason, or the key and budget to record against.
   */
  check(keyHash, model, now) {
    if (!this.usable(now)) return { ok: false, status: 503, reason: "unavailable" };
    const key = this.#keys.get(keyHash);
    if (!key) return { ok: false, status: 401, reason: "invalid_key" };
    if (model === null) return { ok: true, key, budget: null };

    const group = groupForModel(this.snapshot.groups, model);
    const budget = group ? this.#budgets.get(`${key.ownerEmail}|${group.slug}`) : undefined;
    if (!budget || !budget.allowed) return { ok: false, status: 403, reason: "model_not_allowed", model };
    if (budget.tokens === null) return { ok: true, key, budget };

    const remaining =
      budget.tokens + budget.bonus - budget.used - this.#inFlight(key.ownerEmail, budget.groupSlug, budget.periodStart);
    if (remaining <= 0) {
      return { ok: false, status: 429, reason: "budget_exhausted", groupSlug: budget.groupSlug, resetAt: budget.resetAt };
    }
    return { ok: true, key, budget };
  }

  /** Adds one request's usage. `check` is the passing result the request was admitted with. */
  record({ check, model, usage, now }) {
    if (!check?.ok || !check.budget) return;
    const at = new Date(now).toISOString();
    addInto(this.#pending, {
      ownerEmail: check.key.ownerEmail,
      groupSlug: check.budget.groupSlug,
      model,
      periodStart: check.budget.periodStart,
      day: at.slice(0, 10),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      requests: 1,
    });
    this.touch(check.key.id, at);
  }

  touch(keyId, at) {
    const prev = this.#touched.get(keyId);
    if (!prev || prev < at) this.#touched.set(keyId, at);
  }

  /**
   * Everything pending, emptied out; null when there is nothing to send. The
   * batch keeps counting against budgets until a snapshot taken after its
   * confirmed flush replaces it, so a failed or retried push never frees budget.
   */
  drainBatch() {
    if (this.#pending.size === 0 && this.#touched.size === 0) return null;
    const batch = {
      deltas: [...this.#pending.values()],
      touched: [...this.#touched].map(([id, at]) => ({ id, at })),
    };
    this.#pending = new Map();
    this.#touched = new Map();
    if (batch.deltas.length > 0) this.#unconfirmed.push({ at: Infinity, deltas: batch.deltas, batch });
    return batch;
  }

  /** The portal accepted `batch` at `at`; the first snapshot fetched after that includes it. */
  confirmBatch(batch, at) {
    const entry = this.#unconfirmed.find((u) => u.batch === batch);
    if (entry) entry.at = at;
  }

  /** A batch the portal will never accept: stop holding its usage against budgets. */
  releaseBatch(batch) {
    this.#unconfirmed = this.#unconfirmed.filter((u) => u.batch !== batch);
  }
}
