import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The content-route header (spec 18): an accent eyebrow (icon + label), a serif
 * title, and a muted description. Used by every content surface (KB, Tasks,
 * Meetings, Projects, Artifacts, Shared Docs) so their headings stay uniform.
 */
export function PageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  className,
}: {
  eyebrow: ReactNode;
  icon?: ComponentType<LucideProps>;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-ink">
        {Icon && <Icon className="size-4" aria-hidden />}
        {eyebrow}
      </div>
      <h2 className="mb-1.5 text-[27px] font-medium tracking-tight text-ink [font-family:var(--serif)] text-balance">
        {title}
      </h2>
      {description && (
        <p className="max-w-[62ch] text-ink-muted text-pretty">{description}</p>
      )}
    </header>
  );
}
