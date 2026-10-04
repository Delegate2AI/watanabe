"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "./access-ui";
import { ConnectorMetaFields } from "./connectors-meta-fields";
import { ConnectorOauthFields } from "./connectors-oauth-fields";
import type { ConnectorEntryInput, ConnectorRow, FormValues } from "./connectors-form-types";
import { initialValues, maybe, splitList, staleGroups, textToPairs } from "./connectors-form-utils";

export type { ConnectorEnvVar, ConnectorEntryInput, ConnectorRow } from "./connectors-form-types";

const TRANSPORTS = ["http", "sse", "stdio"] as const;

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-faint";
const areaClass = "min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent";

/**
 * The add / edit form. Transport picks which half of the fields applies:
 * `http`/`sse` carry a url and headers, `stdio` carries a command, args, and
 * env. The other half is not submitted, because `EntrySchema` is strict and
 * refuses an entry that carries both.
 */
export function ConnectorsForm({
  row,
  groupNames,
  pending,
  onSubmit,
  onCancel,
}: {
  /** The entry being edited, or null for a new one. */
  row: ConnectorRow | null;
  groupNames: string[];
  pending: boolean;
  onSubmit: (slug: string, entry: ConnectorEntryInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() => initialValues(row, groupNames));
  const [error, setError] = useState("");
  const editing = row !== null;
  const remote = values.transport !== "stdio";
  const stale = staleGroups(row, groupNames);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function toggleGroup(group: string, next: boolean): void {
    setValues((current) => ({
      ...current,
      groups: next ? [...current.groups, group] : current.groups.filter((name) => name !== group),
    }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const slug = values.slug.trim();
    const title = values.title.trim();
    if (!slug || !title) return setError("A slug and a title are both required.");
    if (remote && !values.url.trim()) return setError("An http or sse connector needs a url.");
    if (!remote && !values.command.trim()) return setError("A stdio connector needs a command.");
    setError("");
    const entry: ConnectorEntryInput = {
      title,
      transport: values.transport,
      groups: values.groups,
      ...(remote
        ? { url: values.url.trim(), ...maybe("headers", textToPairs(values.headers)) }
        : {
          command: values.command.trim(),
          ...maybe("args", splitList(values.args, "\n")),
          ...maybe("env", textToPairs(values.env)),
        }),
      ...maybe("tools", splitList(values.tools, ",")),
      ...maybe("description", values.description.trim() || undefined),
      ...maybe("icon", values.icon || undefined),
      ...(remote && values.auth === "oauth"
        ? {
          auth: "oauth" as const,
          ...maybe("oauthClientId", values.oauthClientId.trim() || undefined),
          ...maybe("oauthClientSecret", values.oauthClientSecret.trim() || undefined),
          ...maybe("authOrigins", splitList(values.authOrigins, "\n")),
        }
        : {}),
    };
    if (await onSubmit(slug, entry)) setValues(initialValues(null, groupNames));
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h3 className="font-semibold text-ink">{editing ? `Edit ${row.slug}` : "Add a connector"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={labelClass}>Slug</span>
          <input value={values.slug} onChange={(e) => set("slug", e.target.value)} disabled={editing} readOnly={editing} className={inputClass} placeholder="linear" />
        </label>
        <label className="grid gap-1">
          <span className={labelClass}>Title</span>
          <input value={values.title} onChange={(e) => set("title", e.target.value)} className={inputClass} placeholder="Linear" />
        </label>
      </div>

      <ConnectorMetaFields
        description={values.description}
        icon={values.icon}
        onDescriptionChange={(value) => set("description", value)}
        onIconChange={(value) => set("icon", value)}
      />

      <fieldset className="grid gap-1">
        <legend className={labelClass}>Transport</legend>
        <div className="flex gap-4 pt-1">
          {TRANSPORTS.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm text-ink">
              <input type="radio" name="transport" value={option} checked={values.transport === option} onChange={() => set("transport", option)} />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      {remote ? (
        <>
          <label className="grid gap-1">
            <span className={labelClass}>URL</span>
            <input value={values.url} onChange={(e) => set("url", e.target.value)} className={inputClass} placeholder="https://mcp.example.com/mcp" />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Headers</span>
            <textarea value={values.headers} onChange={(e) => set("headers", e.target.value)} className={areaClass} placeholder="Authorization: Bearer ${EXAMPLE_TOKEN}" />
            <span className="text-xs text-ink-faint">One per line, Name: value. Secrets stay as {"${VAR}"} references.</span>
          </label>
          <ConnectorOauthFields
            auth={values.auth}
            oauthClientId={values.oauthClientId}
            oauthClientSecret={values.oauthClientSecret}
            authOrigins={values.authOrigins}
            onAuthChange={(value) => set("auth", value)}
            onClientIdChange={(value) => set("oauthClientId", value)}
            onClientSecretChange={(value) => set("oauthClientSecret", value)}
            onAuthOriginsChange={(value) => set("authOrigins", value)}
          />
        </>
      ) : (
        <>
          <label className="grid gap-1">
            <span className={labelClass}>Command</span>
            <input value={values.command} onChange={(e) => set("command", e.target.value)} className={inputClass} placeholder="npx" />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Arguments</span>
            <textarea value={values.args} onChange={(e) => set("args", e.target.value)} className={areaClass} placeholder={"-y\n@example/mcp-server"} />
            <span className="text-xs text-ink-faint">One argument per line.</span>
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Environment</span>
            <textarea value={values.env} onChange={(e) => set("env", e.target.value)} className={areaClass} placeholder="EXAMPLE_TOKEN: ${EXAMPLE_TOKEN}" />
            <span className="text-xs text-ink-faint">One per line, NAME: value.</span>
          </label>
        </>
      )}

      <fieldset className="grid gap-1">
        <legend className={labelClass}>Groups</legend>
        <div className="flex flex-wrap gap-3 pt-1">
          {groupNames.length === 0 && <span className="text-sm text-ink-muted">No groups exist yet. Create one under Access administration.</span>}
          {groupNames.map((group) => (
            <label key={group} className="flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" checked={values.groups.includes(group)} onChange={(e) => toggleGroup(group, e.target.checked)} />
              {group}
            </label>
          ))}
        </div>
        <span className="text-xs text-ink-faint">Only members of a listed group are offered this connector. No group means nobody.</span>
        {stale.length > 0 && (
          <p className="text-xs text-amber-600 text-pretty" data-testid="stale-groups">
            {stale.join(", ")} no longer exist{stale.length === 1 ? "s" : ""} in access/groups.yaml and grant{stale.length === 1 ? "s" : ""} nobody
            anything. Saving drops {stale.length === 1 ? "it" : "them"} from this connector.
          </p>
        )}
      </fieldset>

      <label className="grid gap-1">
        <span className={labelClass}>Tools</span>
        <input value={values.tools} onChange={(e) => set("tools", e.target.value)} className={inputClass} placeholder="search_issues, create_issue" />
        <span className="text-xs text-ink-faint">Comma separated. Leave empty to allow every tool the server offers.</span>
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} bg-accent text-white`}>
          {editing ? "Save connector" : "Add connector"}
        </button>
        <button type="button" onClick={onCancel} className={`${buttonClass} bg-surface-2 text-ink`}>Cancel</button>
      </div>
    </form>
  );
}
