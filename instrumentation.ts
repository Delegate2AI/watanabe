/**
 * Next.js server-startup hook (stable since Next 15; auto-detected at the repo
 * root, runs once per server instance before any request is handled — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 *
 * Chosen over a `scripts/repo-sync.sh` + Dockerfile `CMD` wrapper because it
 * keeps the clone/refresh logic in TypeScript, next to `lib/repo.ts`, and
 * testable/importable like any other module — no separate shell-scripting
 * surface to maintain. `register()` runs in both `next dev`/`next start` and
 * the standalone `node server.js` used in the container image.
 *
 * `portal.yaml` is loaded FIRST (spec 16), and unlike everything below it, a
 * failure here is fatal. That deliberately inverts `refreshRepo()`'s
 * resilience contract: a flaky network must never flap a pod, but a
 * misconfiguration is not a flaky dependency. A pod that boots serving the
 * wrong auth mode, or with authentication disabled, is worse than a pod that
 * does not boot at all. Loading it here also means a bad file is caught at
 * rollout rather than surfacing as a 500 on whichever request first touches
 * the config.
 *
 * The read-path clone/refresh always runs — see `lib/repo.ts`'s
 * `refreshRepo()` for the resilience contract (never throws; a failed
 * clone/fetch must not take the server down). The extra try/catch here is a
 * last-resort guard in case that contract is ever violated by a future
 * change. The memory-subsystem worktree bootstrap runs next, gated only on
 * its own `MEMORY_ENABLED` flag (independent of `KB_WRITE_ENABLED`; see
 * `lib/memory/config.ts`). Everything after that is write-path-only
 * (unshallow, orphan-worktree sweep, periodic refresh) and short-circuits
 * entirely when `KB_WRITE_ENABLED` is unset.
 */
export async function register() {
  // `register()` runs in both the Node.js and Edge runtimes; the repo
  // checkout only matters to the Node.js server process (Edge middleware
  // never touches it), and `node:child_process`/`node:fs` aren't available on
  // Edge anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Deliberately NOT wrapped in try/catch, and deliberately before everything
  // else: a bad `portal.yaml` must stop the process, not degrade it.
  const { primeConfig } = await import("@/lib/config");
  const config = primeConfig();
  console.log(`[config] auth.mode=${config.auth.mode}, app.name=${JSON.stringify(config.app.name)}`);
  // Which credential path the agent SDK will use (a non-secret mode name, never
  // the token/key). Makes local subscription-vs-metered runs visible at boot.
  console.log(`[agent-auth] mode=${(await import("@/lib/agent/auth")).agentAuthMode()}`);
  if (config.auth.mode === "none") {
    console.warn(
      "[config] AUTHENTICATION IS DISABLED (auth.mode: none). Every request is " +
        `authenticated as ${config.auth.none.email}. This is enabled by PORTAL_ALLOW_NO_AUTH=1.`,
    );
  }

  // Errors reach PostHog from here on. Registered right after the config load
  // so a failure in any of the boot steps below is itself reported, and before
  // the request path opens. `log.error` is the app's error contract: the
  // never-throws modules report failure by logging, so `onRequestError` alone
  // would see almost none of them.
  const { setErrorSink } = await import("@/lib/log");
  const { captureServerException } = await import("@/lib/analytics/server");
  const { analyticsIdFor } = await import("@/lib/analytics/config");
  setErrorSink((msg, fields) => {
    // `owner`/`email` are what the log call sites name the person they failed
    // on. Hashed here, the failure is attributable without the address leaving
    // the cluster; the raw value is scrubbed out of the properties downstream.
    const person = [fields?.owner, fields?.email].find((v) => typeof v === "string" && v.includes("@"));
    captureServerException(msg, {
      ...(person ? { distinctId: analyticsIdFor(person as string) } : {}),
      properties: { ...fields, source: "log" },
    });
  });

  const { refreshRepo, ensureFullHistoryForWrite } = await import("@/lib/repo");
  try {
    await refreshRepo();
  } catch (err) {
    console.error("[instrumentation] repo refresh failed unexpectedly:", err);
  }

  // Index subsystem: rebuild the generated vault INDEX right after the read
  // checkout refresh above, independent of KB_WRITE_ENABLED (same placement
  // rationale as the memory bootstrap right below). rebuildIndex() never
  // throws.
  if ((await import("@/lib/index/config")).isIndexEnabled()) {
    (await import("@/lib/index/cache")).rebuildIndex();
  }

  // Memory subsystem: clone/seed the portal-memory worktree at boot when
  // enabled. Independent of KB_WRITE_ENABLED (it uses its own branch and only
  // needs REPO_WRITE_TOKEN). ensureMemoryWorktree never throws (returns false).
  const { isMemoryEnabled } = await import("@/lib/memory/config");
  if (isMemoryEnabled()) {
    const { ensureMemoryWorktree } = await import("@/lib/memory/repo-memory");
    const ready = await ensureMemoryWorktree();
    console.log(`[instrumentation] portal-memory worktree ${ready ? "ready" : "unavailable"}`);
  }

  // Background-job orchestration (spec 23): register the built-in job handlers
  // so the cron route and CLI can resolve them, then recover any run left
  // `processing` by a crashed pod. registerBuiltInJobs() MUST precede the
  // recovery pass: bootJobs() skips a stuck run whose job is not registered.
  // This is BEFORE the write-path gate below because the core jobs (repo-refresh,
  // reconcile) do not need the write path; individual jobs stay flag-gated at
  // dispatch, so registering them here is safe regardless of enabled phases.
  try {
    (await import("@/lib/jobs/handlers")).registerBuiltInJobs();
    (await import("@/lib/jobs/queue")).bootJobs();
  } catch (err) {
    console.error("[instrumentation] job orchestration boot failed unexpectedly:", err);
  }

  // Write-path-only follow-up boot steps — skipped entirely on a read-only
  // deploy (KB_WRITE_ENABLED unset), so it never pays for work it can't use.
  const { isKbWriteEnabled } = await import("@/lib/agent/permissions");
  if (!isKbWriteEnabled()) return;

  // The managed checkout is cloned shallow for the read path, which breaks
  // `git rebase` — unshallow it once (see lib/repo.ts's doc comment).
  try {
    await ensureFullHistoryForWrite();
  } catch (err) {
    console.error("[instrumentation] unshallow-for-write failed unexpectedly:", err);
  }

  // Drop any worktree left over from a pod that died mid-edit, and reconcile
  // git's own worktree registry, before any request can try to use one (see
  // lib/repo-write.ts's doc comment — never throws).
  const { sweepOrphanWorktrees } = await import("@/lib/repo-write");
  await sweepOrphanWorktrees();

  // Packages subsystem: requeue anything stuck `processing` and drain the
  // queue of pending package jobs. Placed AFTER the orphan-worktree sweep
  // above: a package job left `processing` by a crashed pod owns a worktree
  // too, so its cleanup is best-effort across restarts via that same sweep,
  // same as any other write-path worktree. `isPackagesEnabled()` itself now
  // also requires KB_WRITE_ENABLED (packages jobs need the write path to ever
  // submit anything), so this outer `if` is redundant with that check but
  // kept for the early-return shape the rest of this block already has.
  try {
    if ((await import("@/lib/packages/config")).isPackagesEnabled()) {
      (await import("@/lib/packages/queue")).bootPackages();
    }
  } catch (err) {
    console.error("[instrumentation] bootPackages failed unexpectedly:", err);
  }

  // Meetings subsystem: requeue any meeting left `processing` by a crashed pod
  // and drain the queued backlog. Same write-path placement rationale as
  // bootPackages above: direct-commit ingestion writes notes through the write
  // path, so recovery is pointless without it. Gated by MEETINGS_ENABLED.
  try {
    if ((await import("@/lib/meetings/config")).isMeetingsEnabled()) {
      (await import("@/lib/meetings/queue")).bootMeetings();
    }
  } catch (err) {
    console.error("[instrumentation] bootMeetings failed unexpectedly:", err);
  }

  // Tasks subsystem: boot hook for symmetry with the other subsystems. A no-op
  // today (task extraction is synchronous inside meeting ingestion and recovers
  // via bootMeetings above); gated internally by TASKS_ENABLED, never throws.
  try {
    (await import("@/lib/tasks/boot")).bootTasks();
  } catch (err) {
    console.error("[instrumentation] bootTasks failed unexpectedly:", err);
  }

  // `mr`-mode freshness fallback: `direct` mode refreshes eagerly right after
  // its own push (see lib/kb-mcp/write-tools.ts), and the GitLab webhook
  // (app/api/repo/refresh/route.ts) refreshes on merge — this interval is the
  // backstop for whenever neither of those has fired yet.
  const intervalMs = Number(process.env.REPO_REFRESH_INTERVAL_MS) || 5 * 60 * 1000;
  setInterval(() => {
    void refreshRepo()
      // Same tick reconciles artifacts waiting on review: a merged merge request
      // otherwise left its artifact at `in_review` forever, since nothing else
      // in the app watches GitLab. This is the backstop for deployments with no
      // refresh webhook configured; with one, they find out sooner. After the
      // refresh, so a promoted artifact's note is already in the checkout.
      .then(async () => {
        const { reconcileInReviewArtifacts } = await import("@/lib/artifacts/reconcile");
        const { getDb } = await import("@/lib/db/client");
        await reconcileInReviewArtifacts(getDb());
      })
      .catch((err) => {
        console.error("[instrumentation] periodic repo refresh failed unexpectedly:", err);
      });
  }, intervalMs).unref(); // must never keep the process alive on its own
}

/**
 * Next's server-error hook: every uncaught error from a route handler, server
 * component render or server action lands here (see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 *
 * The signature is Next's `InstrumentationOnRequestError`, written out rather
 * than imported: the type lives at a deep `next/dist` path with no public
 * re-export.
 */
export async function onRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string; headers: NodeJS.Dict<string | string[]> }>,
  context: Readonly<{ routerKind: string; routePath: string; routeType: string }>,
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { captureServerException } = await import("@/lib/analytics/server");
    const distinctId = await distinctIdFromHeaders(request.headers);
    captureServerException(error, {
      ...(distinctId ? { distinctId } : {}),
      properties: {
        path: request.path,
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
        source: "request",
      },
    });
  } catch (err) {
    console.error("[instrumentation] onRequestError reporting failed:", err);
  }
}

/**
 * The reporting person's pseudonymous analytics id, or undefined when the
 * request carried no identity (an unauthenticated path, or auth itself failing).
 */
async function distinctIdFromHeaders(
  headers: NodeJS.Dict<string | string[]>,
): Promise<string | undefined> {
  try {
    const source = {
      get: (name: string) => {
        const value = headers[name.toLowerCase()];
        return (Array.isArray(value) ? value[0] : value) ?? null;
      },
    };
    const { getIdentity } = await import("@/lib/auth/identity");
    const identity = await getIdentity(source);
    if (!identity) return undefined;
    const { analyticsIdFor } = await import("@/lib/analytics/config");
    return analyticsIdFor(identity.email);
  } catch {
    // An error report is worth sending unattributed; it is not worth a second
    // failure on the way out.
    return undefined;
  }
}
