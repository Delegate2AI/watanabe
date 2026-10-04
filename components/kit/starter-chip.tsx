import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A Home quick-action chip (spec 18): icon + label on a raised surface pill.
 * Renders as a `next/link` when `href` is given, otherwise a `button` that fires
 * `onClick` (e.g. prefill the composer). One or the other, never both.
 */
export function StarterChip({
  label,
  icon: Icon,
  href,
  onClick,
  className,
}: {
  label: ReactNode;
  icon?: ComponentType<LucideProps>;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cn(
    "inline-flex items-center gap-2 rounded-chip border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-card transition-colors hover:border-ink-faint hover:bg-surface-2",
    className,
  );
  const inner = (
    <>
      {Icon && <Icon className="size-[15px] text-ink-muted" aria-hidden />}
      {label}
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
