"use client";

export interface AuthoredSkill {
  slug: string;
  title: string;
  description: string;
  groups: string[];
  rev: string;
}

export function SkillCard({
  skill,
  busy,
  onEdit,
  onDelete,
}: {
  skill: AuthoredSkill;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{skill.title}</h3>
      {skill.description && <p className="text-sm text-ink-muted text-pretty">{skill.description}</p>}
      <p className="text-xs text-ink-faint">
        {skill.groups.length > 0 ? `Published to ${skill.groups.join(", ")}` : "Published to nobody yet"}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded-md border border-line px-3 py-1 text-sm font-medium text-warn hover:bg-surface-2 disabled:opacity-60"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
