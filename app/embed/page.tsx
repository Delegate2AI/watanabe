import { headers } from "next/headers";
import { getIdentity } from "@/lib/auth/identity";
import { isMemoryEnabled } from "@/lib/memory/config";
import { isDictationEnabled } from "@/lib/dictate/config";
import { modelAllowlist, isModelSwitchingEnabled } from "@/lib/agent/model-options";
import { getConfig, getPublicConfig } from "@/lib/config";
import { AppConfigProvider } from "@/components/app-config-provider";
import { AgentChat } from "@/components/agent/agent-chat";

/**
 * Stripped-down chat, meant to run inside the Quartz docs site's slide-out
 * iframe (quartz/quartz/components/KbChat.tsx) — no page nav/chrome, just the
 * chat sized to fill a narrow panel. Framing is only allowed for this route:
 * see the `frame-ancestors` CSP scoped to `/embed` in next.config.ts.
 *
 * `?page=<doc title>` (set by the Quartz widget from the current page's
 * frontmatter title) surfaces as a contextual starter card — see
 * pageContextStarter() in components/agent/empty-state.tsx.
 *
 * This route sits OUTSIDE the `(site)` route group, so it does not inherit that
 * group's `AppConfigProvider` and seeds its own (spec 16). Without it the
 * starter cards here would silently fall back to the built-in defaults while
 * every other route honored `portal.yaml`.
 *
 * The "Open full chat in new tab" link here is a *second* copy of the same
 * escape hatch the Quartz widget already renders next to its toggle button
 * (redundant on purpose — the SSO cookie's cross-origin-iframe behavior is
 * unverified without a live deploy, so both paths out of the iframe stay
 * reachable independently).
 */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const identity = await getIdentity(await headers());
  const { page } = await searchParams;
  const { app } = getConfig();

  return (
    <AppConfigProvider config={getPublicConfig()}>
      <main className="flex h-dvh flex-col overflow-hidden bg-[var(--background)] px-3 py-3">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--color-ink-strong)]">{app.navLabel}</span>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            Open full chat in new tab ↗
          </a>
        </div>
        <AgentChat
          identity={identity}
          compact
          pageContext={page}
          memoryEnabled={isMemoryEnabled()}
          dictationEnabled={isDictationEnabled()}
          models={modelAllowlist()}
          modelSwitchingEnabled={isModelSwitchingEnabled()}
        />
      </main>
    </AppConfigProvider>
  );
}
