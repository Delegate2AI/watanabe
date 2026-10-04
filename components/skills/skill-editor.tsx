"use client";

import { useState } from "react";

export interface SkillDraft {
  title: string;
  description: string;
  groups: string[];
  body: string;
}

export interface EditorTarget {
  slug: string;
  title: string;
  description: string;
  groups: string[];
  body: string;
}

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60";
const LABEL_CLASS = "block text-xs font-medium text-ink-muted";

export function SkillEditor({
  grantGroups,
  target,
  busy,
  onSubmit,
  onCancel,
}: {
  grantGroups: string[];
  target: EditorTarget | null;
  busy: boolean;
  onSubmit: (draft: SkillDraft) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(target?.title ?? "");
  const [description, setDescription] = useState(target?.description ?? "");
  const [groups, setGroups] = useState<string[]>(target?.groups ?? []);
  const [body, setBody] = useState(target?.body ?? "");

  const editing = target !== null;
  const ready =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    body.trim().length > 0 &&
    groups.length > 0;

  function toggleGroup(group: string): void {
    setGroups((current) =>
      current.includes(group) ? current.filter((name) => name !== group) : [...current, group],
    );
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">
        {editing ? `Editing ${target.title}` : "Write a new skill"}
      </h2>

      <div className="mt-3">
        <label className={LABEL_CLASS} htmlFor="skill-title">
          Title
        </label>
        <input
          id="skill-title"
          value={title}
          maxLength={64}
          disabled={busy}
          readOnly={editing}
          onChange={(e) => setTitle(e.target.value)}
          className={editing ? `${FIELD_CLASS} text-ink-muted` : FIELD_CLASS}
        />
        {editing && (
          <p className="mt-1 text-xs text-ink-faint">
            The title sets the address of the skill, so it stays fixed once published. Delete this
            skill and write a new one under the name you want.
          </p>
        )}
      </div>

      <div className="mt-3">
        <label className={LABEL_CLASS} htmlFor="skill-description">
          Description
        </label>
        <input
          id="skill-description"
          value={description}
          maxLength={1024}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-ink-faint">
          One line telling the agent when to reach for this skill.
        </p>
      </div>

      <fieldset className="mt-3">
        <legend className={LABEL_CLASS}>Groups</legend>
        {grantGroups.length === 0 ? (
          <p className="mt-1 text-xs text-ink-faint">You have no groups to publish to yet.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-3">
            {grantGroups.map((group) => (
              <span key={group} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  id={`skill-group-${group}`}
                  type="checkbox"
                  checked={groups.includes(group)}
                  disabled={busy}
                  onChange={() => toggleGroup(group)}
                />
                <label htmlFor={`skill-group-${group}`}>{group}</label>
              </span>
            ))}
          </div>
        )}
      </fieldset>

      <div className="mt-3">
        <label className={LABEL_CLASS} htmlFor="skill-body">
          Skill content
        </label>
        <textarea
          id="skill-body"
          value={body}
          rows={10}
          maxLength={100_000}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Markdown instructions the agent follows."
          className={`${FIELD_CLASS} font-mono`}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => onSubmit({ title: title.trim(), description: description.trim(), groups, body })}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {editing ? "Save changes" : "Create skill"}
        </button>
        {editing && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-line px-4 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
