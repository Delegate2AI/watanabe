import type { ReactNode } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A document rendered as a horizontal card (spec 18): accent doc glyph, title,
 * and a muted subline (type / version / action). Reused for the in-thread
 * "open in canvas" reference (chat, spec 24) and to back Artifacts / Shared
 * Docs listings. Renders as a `next/link` when `href` is given, otherwise a
 * `button` firing `onClick`.
 */
export function DocCard({
  title,
  subtitle,
  href,
  onClick,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cn(
    "flex w-full items-center gap-3 rounded-chip border border-line bg-surface-2 p-3 text-left transition-colors hover:border-accent",
    className,
  );
  const inner = (
    <>
      <FileText className="size-[18px] shrink-0 text-accent" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">
          {title}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-ink-muted">
            {subtitle}
          </span>
        )}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {inner}
    </button>
  );
}
