import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Check, FilePlus2, Loader2, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TurnRole = "user" | "assistant";

/** Lifecycle of the "Save as artifact" affordance, driven by the parent. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * One chat turn (spec 18): an avatar plus the message body. The user avatar can
 * be overridden with an initial (the shell passes the identity initial); the
 * assistant is the accent sparkle. Presentational only, so it renders without a
 * provider in tests. Real streaming/content is spec 24.
 *
 * `onSaveAsArtifact` (spec 27) is the promote-to-artifact affordance: when the
 * parent supplies it (only when `ARTIFACTS_ENABLED`, since the parent owns the
 * flag), an assistant turn renders a "Save as artifact" button that captures
 * that turn's body as a draft artifact. Absent the callback the button never
 * renders, so flag-off leaves the turn byte-identical. Never offered on a user
 * turn: only the assistant produces a document worth promoting.
 */
export function ThreadTurn({
  role,
  avatar,
  children,
  onSaveAsArtifact,
  saveState = "idle",
  savedHref,
}: {
  role: TurnRole;
  avatar?: ReactNode;
  children: ReactNode;
  onSaveAsArtifact?: () => void;
  /** Save lifecycle for the artifact affordance; drives the button/confirmation. */
  saveState?: SaveState;
  /** Link to the created artifact, shown once `saveState` is "saved". */
  savedHref?: string;
}) {
  const isUser = role === "user";
  const showSaveAsArtifact = !isUser && onSaveAsArtifact !== undefined;
  return (
    <div className="mb-6 flex gap-3" data-role={role}>
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
          isUser
            ? "border border-line bg-surface-2 text-ink-muted"
            : "bg-accent text-white",
        )}
      >
        {avatar ??
          (isUser ? (
            <User className="size-3.5" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          ))}
      </div>
      <div
        className={cn(
          "min-w-0 pt-0.5 leading-relaxed",
          isUser ? "font-medium text-ink" : "text-ink",
        )}
      >
        {children}
        {showSaveAsArtifact ? (
          <div className="mt-2 text-xs">
            {saveState === "saved" ? (
              <span
                className="inline-flex items-center gap-1.5 font-medium text-accent"
                role="status"
              >
                <Check className="size-3.5" aria-hidden />
                Saved as artifact
                {savedHref ? (
                  <>
                    {" · "}
                    <Link href={savedHref} className="text-accent underline-offset-2 hover:underline">
                      View
                    </Link>
                  </>
                ) : null}
              </span>
            ) : saveState === "saving" ? (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-medium text-ink-muted opacity-70"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Saving…
              </button>
            ) : saveState === "error" ? (
              <button
                type="button"
                onClick={onSaveAsArtifact}
                className="inline-flex items-center gap-1.5 rounded-md border border-warn/40 px-2 py-1 font-medium text-warn transition-colors hover:bg-warn/5"
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                Couldn&apos;t save. Retry
              </button>
            ) : (
              <button
                type="button"
                onClick={onSaveAsArtifact}
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <FilePlus2 className="size-3.5" aria-hidden />
                Save as artifact
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
