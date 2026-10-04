"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import { buttonClass } from "./access-ui";
import { DesignGuidePreview, type PreviewState } from "./design-guide-preview";

/**
 * The `/admin/design` surface: the art direction the assistant follows when it
 * writes a designed document.
 *
 * Only half the guidance is here. The constraints (no external assets, no
 * script, the bundled font set, the shape of a whole document) are a code
 * constant and are shown read-only, because editing them does not change taste,
 * it produces documents that fail quietly weeks later. What this page can change
 * is everything that only affects how a document looks.
 */

export interface GuideProblem {
  line: number;
  reason: string;
}

export interface DesignGuideState {
  text: string;
  source: "stored" | "default";
}

export function DesignGuideAdmin({
  guide,
  builtIn,
  constraints,
  maxBytes,
}: {
  guide: DesignGuideState;
  /** The guidance the feature ships with, for the restore control. */
  builtIn: string;
  /** The fixed half. Read-only: no route writes it. */
  constraints: string;
  maxBytes: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(guide.text);
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<GuideProblem[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [showConstraints, setShowConstraints] = useState(false);

  const bytes = new TextEncoder().encode(text).length;
  const dirty = text.trim() !== guide.text.trim();
  const isBuiltIn = text.trim() === builtIn.trim();

  async function save(): Promise<void> {
    setPending(true);
    setProblems([]);
    try {
      const response = await fetch("/api/admin/design-guide", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setProblems(Array.isArray(body?.problems) ? body.problems : []);
        notifyFailure(messageForBody(body));
        return;
      }
      notifySuccess("Design guide saved. New sessions pick it up immediately.");
      router.refresh();
    } catch {
      notifyFailure("The design guide could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function tryIt(): Promise<void> {
    setPending(true);
    setProblems([]);
    setPreview({ status: "running" });
    try {
      const response = await fetch("/api/admin/design-guide/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setProblems(Array.isArray(body?.problems) ? body.problems : []);
        setPreview({ status: "failed", message: messageForBody(body) });
        return;
      }
      setPreview({ status: "ready", html: String(body?.html ?? "") });
    } catch {
      setPreview({ status: "failed", message: "The sample document could not be written." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {guide.source === "default"
            ? "Currently using the built-in guide."
            : "Currently using an edited guide."}{" "}
          Every save is a commit on the private access history.
        </p>
        <p className={`text-xs ${bytes > maxBytes ? "text-warn" : "text-ink-muted"}`}>
          {bytes} / {maxBytes} bytes
        </p>
      </div>

      <label htmlFor="design-guide" className="sr-only">
        Design guide
      </label>
      <textarea
        id="design-guide"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className="h-[50vh] w-full rounded-lg border border-line bg-surface p-4 font-mono text-xs leading-relaxed text-ink outline-none focus:border-accent"
      />

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warn/40 bg-surface p-3 text-sm" role="alert">
          {problems.map((problem) => (
            <li key={`${problem.line}-${problem.reason}`} className="text-ink">
              <span className="font-mono text-xs text-ink-muted">
                {problem.line > 0 ? `line ${problem.line}` : "guide"}
              </span>{" "}
              {problem.reason}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={`${buttonClass} bg-accent text-white hover:opacity-90`}
        >
          {pending ? "Working" : "Save"}
        </button>
        <button
          type="button"
          onClick={tryIt}
          disabled={pending}
          className={`${buttonClass} border border-line text-ink hover:bg-surface-hover`}
        >
          Try it
        </button>
        <button
          type="button"
          onClick={() => setText(builtIn)}
          disabled={pending || isBuiltIn}
          className={`${buttonClass} text-ink-muted hover:bg-surface-hover`}
        >
          Restore built-in guide
        </button>
        {dirty && <span className="text-xs text-ink-muted">Unsaved. Try it runs what is in the box.</span>}
      </div>

      <DesignGuidePreview state={preview} />

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setShowConstraints((shown) => !shown)}
          className="text-sm font-medium text-ink-muted underline-offset-4 hover:underline"
          aria-expanded={showConstraints}
        >
          {showConstraints ? "Hide" : "Show"} the fixed half
        </button>
        <p className="mt-1 text-xs text-ink-muted">
          Sent before the guide above, on every session. Not editable: each line breaks a document rather than
          restyling one.
        </p>
        {showConstraints && (
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-xs leading-relaxed text-ink-muted">
            {constraints}
          </pre>
        )}
      </section>
    </div>
  );
}
