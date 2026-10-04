"use client";

import { useState } from "react";
import { messageForBody } from "@/lib/errors/messages";
import { buttonClass, inputClass } from "./access-ui";
import { GroupPicker } from "./skills-groups";
import { MarketplacePicker } from "./skills-marketplace";
import { gitInstallBody, marketplaceInstallBody } from "./skills-payloads";
import type { InstallBody, MarketplaceItemRow, MarketplaceRow } from "./skills-types";

/**
 * The three ways spec 34 admits a skill: a git remote the admin names, a zip
 * the admin uploads, and a pick from a curated marketplace index.
 *
 * The tabs share one clearance-group selection on purpose. Groups are the
 * decision an admin is actually making (who this skill becomes ambient context
 * for), and it should not silently reset because they switched how the folder
 * arrives.
 *
 * Optional fields are OMITTED from the payload rather than sent empty: the
 * route's schema is strict and bounds `subdir` and `ref` at `min(1)`, so an
 * empty string is a refusal rather than "not set".
 *
 * The marketplace indexes are loaded HERE rather than by the server page, on the
 * first click of that tab, and the result is held in this component's state.
 * That is what keeps the fan-out off `router.refresh()`: this form is never
 * remounted by a refresh, so an admin who installs five picks pays for one load,
 * and an admin who never opens the tab pays for none. See ./skills-marketplace.tsx.
 */

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-faint";

type Tab = "git" | "zip" | "marketplace";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "git", label: "Git" },
  { id: "zip", label: "Zip upload" },
  { id: "marketplace", label: "Marketplace" },
];

export function SkillsInstallForm({
  groupNames,
  marketplaceCount,
  pending,
  onInstall,
  onUpload,
}: {
  groupNames: string[];
  /** How many indexes portal.yaml declares. Read on the server, no network. */
  marketplaceCount: number;
  pending: boolean;
  onInstall: (body: InstallBody) => Promise<boolean>;
  onUpload: (file: File, groups: string[]) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<Tab>("git");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [subdir, setSubdir] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [indexes, setIndexes] = useState<MarketplaceRow[] | null>(null);
  const [loadingIndexes, setLoadingIndexes] = useState(false);
  const [indexError, setIndexError] = useState("");

  /**
   * Pull every configured index through the list route, which already answers
   * `{ entries, marketplaces }`. Reusing it keeps the marketplace fan-out in the
   * one place that owns the scheme allow-list, the deadline, and the body cap.
   */
  async function loadIndexes(): Promise<void> {
    if (marketplaceCount === 0) return;
    setLoadingIndexes(true);
    setIndexError("");
    try {
      const response = await fetch("/api/admin/skills");
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setIndexError(messageForBody(body));
        return;
      }
      const rows = (body as { marketplaces?: unknown } | null)?.marketplaces;
      setIndexes(Array.isArray(rows) ? (rows as MarketplaceRow[]) : []);
    } catch {
      setIndexError("The marketplace indexes could not be loaded.");
    } finally {
      setLoadingIndexes(false);
    }
  }

  /** Loads the indexes the first time the tab is opened, and never on render. */
  function openTab(next: Tab): void {
    setTab(next);
    setError("");
    if (next === "marketplace" && indexes === null && !loadingIndexes) void loadIndexes();
  }

  function toggleGroup(group: string, next: boolean): void {
    setGroups((current) => (next ? [...current, group] : current.filter((name) => name !== group)));
  }

  function reset(): void {
    setUrl("");
    setRef("main");
    setSubdir("");
    setFile(null);
    setGroups([]);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (tab === "zip") {
      if (file === null) return setError("Choose a .zip archive to upload.");
      setError("");
      if (await onUpload(file, groups)) reset();
      return;
    }
    const remote = url.trim();
    const pinned = ref.trim();
    if (remote === "") return setError("A repository URL is required.");
    if (pinned === "") return setError("A branch, tag, or commit is required.");
    setError("");
    const body = gitInstallBody({ url: remote, ref: pinned, subdir: subdir.trim(), groups });
    if (await onInstall(body)) reset();
  }

  async function installItem(index: string, item: MarketplaceItemRow): Promise<void> {
    setError("");
    await onInstall(marketplaceInstallBody(index, item, groups));
  }

  return (
    <form
      aria-label="Install a skill"
      onSubmit={(event) => void submit(event)}
      className="grid gap-4 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)]"
    >
      <h3 className="font-semibold text-ink">Install a skill</h3>

      <div className="flex flex-wrap gap-2">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={tab === option.id}
            onClick={() => openTab(option.id)}
            className={`${buttonClass} ${tab === option.id ? "bg-accent text-white" : "bg-surface-2 text-ink"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "git" && (
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className={labelClass}>Repository URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} placeholder="https://github.com/example/skills.git" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className={labelClass}>Ref</span>
              <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass} placeholder="main" />
              <span className="text-xs text-ink-faint">Branch, tag, or commit. The commit it resolves to is what gets pinned.</span>
            </label>
            <label className="grid gap-1">
              <span className={labelClass}>Subdirectory</span>
              <input value={subdir} onChange={(e) => setSubdir(e.target.value)} className={inputClass} placeholder="skills/pdf" />
              <span className="text-xs text-ink-faint">Optional. Leave empty when the repository is the skill folder.</span>
            </label>
          </div>
        </div>
      )}

      {tab === "zip" && (
        <label className="grid gap-1">
          <span className={labelClass}>Skill archive</span>
          <input
            type="file"
            accept=".zip"
            aria-label="Skill archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-ink"
          />
          <span className="text-xs text-ink-faint">A .zip holding one skill folder with a SKILL.md at its root.</span>
        </label>
      )}

      {tab === "marketplace" && (
        <MarketplacePicker
          configured={marketplaceCount}
          indexes={indexes}
          loading={loadingIndexes}
          error={indexError}
          pending={pending}
          onReload={() => void loadIndexes()}
          onInstall={installItem}
        />
      )}

      <GroupPicker groupNames={groupNames} selected={groups} onToggle={toggleGroup} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {tab !== "marketplace" && (
        <div>
          <button type="submit" disabled={pending} className={`${buttonClass} bg-accent text-white`}>
            {tab === "git" ? "Install from git" : "Install from zip"}
          </button>
        </div>
      )}
    </form>
  );
}
