"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PublicConfig } from "@/lib/config/public";
import { resolveStarterIcon, type StarterIconName } from "@/lib/config/icons";
import type { AgentStarter } from "./agent/agent-starters";
import { GITLAB_TERMS } from "@/lib/git-host/terms";
import type { ChangeRequestTerms } from "@/lib/git-host/types";

/**
 * Carries the PUBLIC slice of `portal.yaml` (spec 16) to client components.
 *
 * The portal is runtime-configured: there are no `NEXT_PUBLIC_*` build-time
 * variables, and one would not track a value that changes per deploy anyway. So
 * a server component reads `getPublicConfig()` and seeds this provider, exactly
 * as `memoryEnabled` is passed down today.
 *
 * `lib/config/index.ts` is `server-only`, so a client component cannot import it
 * and reach `auth.jwt.secret` even by accident. This context is the only route
 * config takes into the browser, and `toPublicConfig()` is what narrows it.
 */

const AppConfigContext = createContext<PublicConfig | null>(null);

export function AppConfigProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

/**
 * Null outside a provider (e.g. a component rendered on a route that has not
 * been wrapped yet), so every consumer degrades to its hardcoded default rather
 * than crashing. Same posture as `useChatContext`.
 */
export function useAppConfig(): PublicConfig | null {
  return useContext(AppConfigContext);
}

/**
 * Starter cards, with `icon` resolved from its allowlisted name back to the
 * lucide component the UI needs. The name was validated at boot, so an unknown
 * one cannot reach here.
 */
export function useStarters(fallback: AgentStarter[]): AgentStarter[] {
  const config = useAppConfig();
  if (!config) return fallback;
  return config.app.starters.map((s) => ({
    id: s.id,
    label: s.label,
    sub: s.sub,
    icon: resolveStarterIcon(s.icon as StarterIconName),
    prompt: s.prompt,
  }));
}

export function useChangeRequestTerms(): ChangeRequestTerms {
  return useAppConfig()?.terms ?? GITLAB_TERMS;
}
