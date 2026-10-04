/**
 * The serializable shapes the `/admin/skills` server page hands down to its
 * client islands (spec 34).
 *
 * Declared here rather than imported from `lib/skills/types` because every
 * consumer is a "use client" module and that module's neighbours reach
 * `node:fs`: pulling one into a client bundle is a hard Turbopack failure. Same
 * reason `components/admin/connectors-form.tsx` declares `ConnectorRow`
 * locally. This file has no imports at all, so it is safe on both sides.
 */

export type SkillSourceRow =
  | { type: "git"; url: string; ref: string; subdir?: string; commit: string }
  | { type: "zip"; filename: string }
  | {
      type: "marketplace";
      index: string;
      name: string;
      url: string;
      subdir?: string;
      commit: string;
    }
  | { type: "authored"; author: string; rev: string };

/** One registry row: an entry that loaded, or a slug the loader rejected. */
export interface SkillRow {
  slug: string;
  status: "ok" | "disabled";
  reason?: string;
  title?: string;
  source?: SkillSourceRow;
  groups?: string[];
  compat?: { scripts: string[]; tools: string[] };
  /** Whether the skill store still holds a directory for this slug. */
  installed: boolean;
  /**
   * The subset of `compat.scripts` whose own relative path trips a Tier 0 bash
   * pattern, so the skill-script carve-out refuses them forever. Derived on the
   * server from the recorded scripts, because `SkillEntry.compat` deliberately
   * persists only `{ scripts, tools }` and this is recomputable at any time.
   */
  blockedScripts: string[];
  /**
   * Whether the recorded script list was capped or clipped when the skill was
   * installed, which makes `blockedScripts` a floor rather than the whole answer.
   * The install-time report derived from the RAW file list and capped afterwards;
   * this row can only see what was persisted. Without saying so, a skill with
   * more scripts than the cap shows the blocked banner at install time and an
   * empty row forever after, which is the silent failure the banner exists to
   * prevent.
   */
  scriptsTruncated: boolean;
}

export interface MarketplaceItemRow {
  name: string;
  description: string;
  url: string;
  ref?: string;
  subdir?: string;
}

/** One configured index: the items it listed, or the reason it could not be read. */
export interface MarketplaceRow {
  /** The source id: an index URL, or the built-in sentinel, which is not a URL. */
  url: string;
  /** What to show above the rows. The built-in source has a name, not an address. */
  label?: string;
  items?: MarketplaceItemRow[];
  errors?: Array<{ item: string; reason: string }>;
  error?: string;
}

/** Which action a result came from, so the copy can name what happened. */
export type SkillActionKind = "install" | "update" | "uninstall" | "groups";

/** A successful action's report, exactly the fields the API answers with. */
export interface SkillOutcome {
  kind: SkillActionKind;
  slug: string;
  replaced?: boolean;
  commit?: string;
  previousCommit?: string;
  warning?: string;
  blockedScripts?: string[];
}

/** The install actions this surface posts as JSON, as the route's schema takes them. */
export type InstallBody =
  | { action: "install-git"; url: string; ref: string; subdir?: string; groups: string[] }
  // No ref and no subdir. The route re-fetches the index and reads both from the
  // entry it finds there, so naming them here would let a client redirect a
  // named pick at a different tree. Its schema is strict, so sending either is a
  // 400 rather than an ignored field.
  | { action: "install-marketplace"; index: string; name: string; url: string; groups: string[] };

/** The actions that name an already-installed skill. */
export type ManageBody =
  | { action: "uninstall"; slug: string }
  | { action: "update"; slug: string }
  | { action: "set-groups"; slug: string; groups: string[] };

/** Everything `POST /api/admin/skills` accepts, which is what the contract test walks. */
export type SkillActionBody = InstallBody | ManageBody;
