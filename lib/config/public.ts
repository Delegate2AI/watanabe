import type { PortalConfig, StarterConfig } from "./schema";
import { GITLAB_TERMS } from "@/lib/git-host/terms";
import type { ChangeRequestTerms } from "@/lib/git-host/types";

/**
 * The ONLY shape of config allowed to cross into the browser (spec 16).
 *
 * The portal is runtime-configured, so there are no `NEXT_PUBLIC_*` build-time
 * variables to lean on: a server component reads this and passes it down as
 * props, exactly as `memoryEnabled` is passed today.
 *
 * Built by naming fields explicitly rather than by deleting `auth` from a copy.
 * A future secret added under a new key is then absent by default, instead of
 * leaking because nobody remembered to add it to a blocklist. `config.public.test.ts`
 * asserts this structurally.
 *
 * `app.kbDescription` is deliberately NOT here: it exists to steer the agent's
 * system prompt (lib/agent/prompts.ts) and the browser has no use for it.
 */
export interface PublicConfig {
  terms: ChangeRequestTerms;
  app: {
    name: string;
    tagline: string;
    navLabel: string;
    composerPlaceholder: string;
    /** Absent when this deployment has no feedback channel. */
    feedbackUrl?: string;
    starters: StarterConfig[];
  };
}

export function toPublicConfig(config: PortalConfig, terms: ChangeRequestTerms = GITLAB_TERMS): PublicConfig {
  return {
    terms,
    app: {
      name: config.app.name,
      tagline: config.app.tagline,
      navLabel: config.app.navLabel,
      composerPlaceholder: config.app.composerPlaceholder,
      // Spread rather than assign `undefined`: the field stays structurally
      // absent when unset, which is what the help dialog reads to hide the link.
      ...(config.app.feedbackUrl ? { feedbackUrl: config.app.feedbackUrl } : {}),
      starters: config.app.starters,
    },
  };
}
