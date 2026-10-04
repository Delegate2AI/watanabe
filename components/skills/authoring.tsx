"use client";

import { useCallback, useEffect, useState } from "react";
import { messageForBody } from "@/lib/errors/messages";
import { SkillCard, type AuthoredSkill } from "./skill-card";
import { SkillEditor, type EditorTarget, type SkillDraft } from "./skill-editor";

interface Loaded {
  skills: AuthoredSkill[];
  grantGroups: string[];
}

const LIST_URL = "/api/skills/authored";

function skillUrl(slug: string): string {
  return `${LIST_URL}/${encodeURIComponent(slug)}`;
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function SkillAuthoring() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(LIST_URL);
      if (!response.ok) {
        setError(messageForBody(await bodyOf(response)));
        setLoaded({ skills: [], grantGroups: [] });
        return;
      }
      const body = (await response.json()) as Partial<Loaded>;
      setLoaded({
        skills: Array.isArray(body.skills) ? body.skills : [],
        grantGroups: Array.isArray(body.grantGroups) ? body.grantGroups : [],
      });
    } catch {
      setError("Your skills could not be loaded.");
      setLoaded({ skills: [], grantGroups: [] });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function submit(draft: SkillDraft): Promise<void> {
    const editing = target;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = editing
        ? { description: draft.description, groups: draft.groups, body: draft.body }
        : {
            title: draft.title,
            description: draft.description,
            body: draft.body,
            groups: draft.groups,
          };
      const response = await fetch(editing ? skillUrl(editing.slug) : LIST_URL, {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setError(messageForBody(await bodyOf(response)));
        return;
      }
      setTarget(null);
      setFormKey((n) => n + 1);
      setNotice(editing ? "Your changes are saved." : "Your skill is published.");
      await load();
    } catch {
      setError(editing ? "Your changes could not be saved." : "The skill could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function edit(skill: AuthoredSkill): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(skillUrl(skill.slug));
      if (!response.ok) {
        setError(messageForBody(await bodyOf(response)));
        return;
      }
      const detail = (await response.json()) as EditorTarget;
      setTarget({
        slug: skill.slug,
        title: detail.title,
        description: detail.description,
        groups: detail.groups,
        body: detail.body,
      });
    } catch {
      setError("That skill could not be opened for editing.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(skill: AuthoredSkill): Promise<void> {
    if (!window.confirm(`Delete "${skill.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(skillUrl(skill.slug), { method: "DELETE" });
      if (!response.ok) {
        setError(messageForBody(await bodyOf(response)));
        return;
      }
      if (target?.slug === skill.slug) {
        setTarget(null);
        setFormKey((n) => n + 1);
      }
      setNotice(`"${skill.title}" is deleted.`);
      await load();
    } catch {
      setError("The skill could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      <SkillEditor
        key={`${target?.slug ?? "new"}-${formKey}`}
        grantGroups={loaded?.grantGroups ?? []}
        target={target}
        busy={busy}
        onSubmit={(draft) => void submit(draft)}
        onCancel={() => {
          setTarget(null);
          setFormKey((n) => n + 1);
        }}
      />

      {loaded !== null &&
        (loaded.skills.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
            You have not authored any skills yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {loaded.skills.map((skill) => (
              <SkillCard
                key={skill.slug}
                skill={skill}
                busy={busy}
                onEdit={() => void edit(skill)}
                onDelete={() => void remove(skill)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
