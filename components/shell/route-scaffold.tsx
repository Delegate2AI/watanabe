import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";

/**
 * The dormant-surface route (spec 18): the shared PageHeader over a dashed note
 * that says the surface is fully built but switched off behind its feature flag.
 * Every flag-off destination uses this so no nav link 404s and each surface
 * already has its final heading. When the surface's `*_ENABLED` flag is on, the
 * page renders its real content instead (Tasks 21, Meetings 20, KB 25, Projects
 * 26, Artifacts 27, Shared Docs 28).
 *
 * This note is deliberately worded to read as "off, not broken": the feature is
 * done and waiting, and an operator turns it on. Pass `flag` to name the exact
 * `*_ENABLED` variable an operator sets so the message is actionable.
 */
export function RouteScaffold({
  icon,
  eyebrow,
  title,
  description,
  spec,
  flag,
}: {
  icon: ComponentType<LucideProps>;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  spec: string;
  flag?: string;
}) {
  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        description={description}
      />
      <div className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
        <p className="font-medium text-ink">Built, but not switched on here</p>
        <p className="mt-1">
          This surface is complete and dormant behind a feature flag. An operator
          turns it on
          {flag ? (
            <>
              {" "}
              by setting <code className="font-mono text-ink">{flag}=1</code>
            </>
          ) : null}{" "}
          ({spec}).
        </p>
      </div>
    </div>
  );
}
