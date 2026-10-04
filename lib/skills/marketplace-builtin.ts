import { getConfig } from "@/lib/config";
import {
  configuredMarketplaces,
  fetchMarketplaceIndex,
  parseMarketplaceIndex,
  type MarketplaceIndex,
} from "./marketplace";
import { BUILTIN_MARKETPLACE_ID } from "./marketplace-id";

/**
 * The index that ships with the app, so the Marketplace tab offers something on
 * a workspace where nobody has configured an index URL (spec 34 shipped with
 * `skills.marketplaces` empty by default, which left that tab dead).
 *
 * It is a document, not a URL, and is never fetched. A default URL would have
 * to point at a live JSON file in this application's own index format, which
 * nobody publishes, so it would fail on first open and be worse than no default
 * at all.
 *
 * **It is parsed by `parseMarketplaceIndex`, the same function that parses a
 * remote index.** Bundling it is not a reason to trust it more: the entry caps,
 * the display-string cleaning, and above all the http(s) restriction on entry
 * urls all still apply. There is deliberately no second, laxer path into the
 * item shape. If this document is ever malformed, it degrades exactly the way a
 * broken remote index does, and the tests below are what keep it honest.
 *
 * ## What is in it, and what is deliberately not
 *
 * One source: Anthropic's own skills repository, which is the reference
 * implementation for the Agent Skills standard this subsystem implements.
 * Shipping a default index means this application vouches for a source, so it
 * vouches for exactly one, from the same vendor as the standard.
 *
 * Five of that repository's seventeen skills are missing on purpose:
 *
 * - `docx`, `pdf`, `pptx`, and `xlsx` are source-available rather than open
 *   source. Their LICENSE.txt adds restrictions on top of Anthropic's terms:
 *   users "may not extract these materials from the Services or retain copies
 *   of these materials outside the Services", and may not reproduce or copy
 *   them. Installing a skill here clones it and retains it on this server's own
 *   volume, which is that restriction exactly. An admin who has an agreement
 *   that permits it can still install them by url on the Git tab. The
 *   application will not steer a workspace into it by default.
 * - `doc-coauthoring` carries no LICENSE.txt and no license field, so its terms
 *   are unknown rather than permissive.
 *
 * The remaining twelve are Apache 2.0, verified per skill rather than assumed
 * from the repository (the repository itself has no top-level license).
 *
 * ## Why no ref is pinned
 *
 * Entries take `DEFAULT_MARKETPLACE_REF`. Pinning a commit here would be the
 * stronger supply-chain position, but a marketplace entry's ref is not
 * persisted onto the installed skill, so a later Update would silently walk a
 * pinned entry back to the default branch. That gap is recorded against spec 34
 * and is not closed here. Until it is, pinning would create a difference
 * between what an install fetched and what an update fetches, which is worse
 * than tracking one branch openly. The commit each install resolves to IS
 * recorded on the entry, so provenance is still exact after the fact.
 */
const BUILTIN_INDEX_DOCUMENT = JSON.stringify({
  skills: [
    {
      name: "algorithmic-art",
      description:
        "Generative art with p5.js: flow fields, particle systems, and seeded randomness, with an interactive viewer.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/algorithmic-art",
    },
    {
      name: "brand-guidelines",
      description:
        "Applies Anthropic's official brand colors and typography to artifacts that should carry that look.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/brand-guidelines",
    },
    {
      name: "canvas-design",
      description:
        "Poster and static visual design, output as .png and .pdf, driven by an explicit design philosophy.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/canvas-design",
    },
    {
      name: "claude-api",
      description:
        "Reference for the Claude API and the Anthropic SDKs: model ids, pricing, streaming, tool use, MCP, caching, and model migration.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/claude-api",
    },
    {
      name: "frontend-design",
      description:
        "Aesthetic direction for new or reworked UI: palette, typography, and layout choices that avoid templated defaults.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/frontend-design",
    },
    {
      name: "internal-comms",
      description:
        "Formats for internal writing: status reports, leadership and 3P updates, newsletters, FAQs, and incident reports.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/internal-comms",
    },
    {
      name: "mcp-builder",
      description:
        "Building MCP servers that expose an external service to an LLM, in Python (FastMCP) or Node and TypeScript.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/mcp-builder",
    },
    {
      name: "skill-creator",
      description:
        "Create, edit, and evaluate skills, including tuning a skill's description so it triggers accurately.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/skill-creator",
    },
    {
      name: "slack-gif-creator",
      description:
        "Animated GIFs sized and validated for Slack, with the platform's constraints built in.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/slack-gif-creator",
    },
    {
      name: "theme-factory",
      description:
        "Ten preset color and font themes, applied to an artifact that already exists or generated on the fly.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/theme-factory",
    },
    {
      name: "web-artifacts-builder",
      description:
        "Multi-component HTML artifacts built with React, Tailwind, and shadcn/ui, then bundled into a single file.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/web-artifacts-builder",
    },
    {
      name: "webapp-testing",
      description:
        "Drive and test a local web application with Playwright: verify behavior, capture screenshots, and read browser logs.",
      url: "https://github.com/anthropics/skills",
      subdir: "skills/webapp-testing",
    },
  ],
});

/** What the Marketplace tab shows above the built-in source's rows. */
export const BUILTIN_MARKETPLACE_LABEL = "Anthropic skills (built in)";

/**
 * Whether the built-in index is offered. Defaults to on, and an operator turns
 * it off with `skills.builtinMarketplace: false` in portal.yaml, which is the
 * lever for a workspace that wants its own curated index and nothing else.
 *
 * Never throws, for the reason `configuredMarketplaces` does not: a malformed
 * portal.yaml already fails the boot prime, and here it must degrade to "no
 * marketplace" rather than throw into an admin route.
 */
export function isBuiltinMarketplaceEnabled(): boolean {
  try {
    return getConfig().skills?.builtinMarketplace ?? true;
  } catch {
    return false;
  }
}

/**
 * Every marketplace an admin may install from: the configured URLs in their
 * configured order, then the built-in one.
 *
 * Configured indexes come FIRST because an operator curating their own is
 * making a deliberate choice, and the one this application ships should not
 * outrank it on their own admin screen. On a workspace that configures nothing,
 * which is the case this whole module exists for, the built-in is the only
 * entry and the order is moot.
 *
 * This is the allow-list `install-marketplace` checks a request against, so a
 * source that is not here cannot be installed from, and the built-in id is a
 * sentinel rather than a URL precisely so it can never be fetched.
 */
export function marketplaceSourceIds(): string[] {
  const builtin = isBuiltinMarketplaceEnabled() ? [BUILTIN_MARKETPLACE_ID] : [];
  return [...configuredMarketplaces(), ...builtin];
}

/**
 * Resolve one source id to its index. The built-in id parses a bundled
 * document and touches no network; anything else is a URL and is fetched.
 *
 * The comparison is against a compile-time constant, so only the exact
 * sentinel takes the local path and every other value goes through the fetch
 * path's scheme allow-list, deadline, and body cap.
 */
export async function resolveMarketplaceIndex(sourceId: string): Promise<MarketplaceIndex> {
  if (sourceId === BUILTIN_MARKETPLACE_ID) return parseMarketplaceIndex(BUILTIN_INDEX_DOCUMENT);
  return fetchMarketplaceIndex(sourceId);
}

/** The bundled document, exported for the tests that hold it to the real parser. */
export const BUILTIN_INDEX_DOCUMENT_FOR_TEST = BUILTIN_INDEX_DOCUMENT;
