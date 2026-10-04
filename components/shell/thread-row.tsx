"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Circle, Lock, Pin, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A pinned/recent conversation entry in the sidebar (spec 18/24). A restricted
 * thread shows a lock (you ARE cleared for it; threads you cannot open are
 * absent entirely, never shown locked). Truncates on overflow.
 *
 * When management handlers are supplied (`onPin`/`onRename`/`onDelete`), the row
 * grows a hover/focus kebab menu so a chat can be pinned, renamed inline, or
 * deleted (with a second confirming click). Without them it renders exactly as
 * the read-only row it always was, so callers that only list stay unchanged.
 */
export function ThreadRow({
  title,
  href,
  restricted = false,
  pinned = false,
  onNavigate,
  onPin,
  onRename,
  onDelete,
}: {
  title: string;
  href: string;
  restricted?: boolean;
  pinned?: boolean;
  onNavigate?: () => void;
  onPin?: (pinned: boolean) => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const manageable = Boolean(onPin || onRename || onDelete);

  if (renaming) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          if (next && next !== title) onRename?.(next);
          setRenaming(false);
        }}
        className="px-2.5 py-1"
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(false);
          }}
          aria-label={`Rename ${title}`}
          maxLength={200}
          className="w-full rounded-control border border-line bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
        />
      </form>
    );
  }

  return (
    <div className="group/row relative flex items-center rounded-control hover:bg-surface-hover">
      <Link
        href={href}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-control px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors group-hover/row:text-ink"
      >
        {pinned ? (
          <Pin className="size-3.5 shrink-0 text-accent" aria-label="Pinned" />
        ) : (
          <Circle className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        )}
        {/* min-w-0 lets this flex item shrink below the title's intrinsic width so
            it actually ellipsizes; without it the row's min-content widened the
            whole sidebar column and the title ran off the right edge. */}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {restricted && (
          <Lock className="size-3 shrink-0 text-warn" aria-label="Restricted (you are cleared)" />
        )}
      </Link>

      {manageable && (
        <>
          <button
            type="button"
            aria-label={`Options for ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
              setConfirmingDelete(false);
            }}
            className="mr-1 grid size-6 shrink-0 place-items-center rounded-control text-ink-faint opacity-0 hover:bg-surface-2 hover:text-ink focus:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
          {menuOpen && (
            <>
              {/* A full-screen click-away so the menu closes on any outside click. */}
              <div className="fixed inset-0 z-10" aria-hidden onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-1 top-full z-20 mt-0.5 w-36 rounded-menu border border-line bg-surface p-1 shadow-elevated"
              >
                {onPin && (
                  <RowMenuItem
                    onClick={() => {
                      onPin(!pinned);
                      setMenuOpen(false);
                    }}
                  >
                    {pinned ? "Unpin" : "Pin"}
                  </RowMenuItem>
                )}
                {onRename && (
                  <RowMenuItem
                    onClick={() => {
                      setDraft(title);
                      setRenaming(true);
                      setMenuOpen(false);
                    }}
                  >
                    Rename
                  </RowMenuItem>
                )}
                {onDelete &&
                  (confirmingDelete ? (
                    <RowMenuItem
                      danger
                      onClick={() => {
                        onDelete();
                        setMenuOpen(false);
                        setConfirmingDelete(false);
                      }}
                    >
                      Confirm delete
                    </RowMenuItem>
                  ) : (
                    <RowMenuItem danger onClick={() => setConfirmingDelete(true)}>
                      Delete
                    </RowMenuItem>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RowMenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-surface-2",
        danger ? "text-warn" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}
