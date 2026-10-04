"use client";

import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppConfig, useStarters } from "@/components/app-config-provider";
import { AGENT_STARTERS, CONTENT_STARTER, type AgentStarter } from "./agent-starters";
import { useCapabilities } from "@/lib/ui/capabilities";

/**
 * When opened from the docs site with `?page=<title>` (see app/embed/page.tsx),
 * prepend a starter card scoped to that page ahead of the generic ones — same
 * `AgentStarter` shape as agent-starters.ts, so it renders through the exact
 * same list/click/prefill path instead of a parallel "page context" UI.
 */
function pageContextStarter(pageContext: string, kbName: string): AgentStarter {
  return {
    id: "page-context",
    label: `Ask about "${pageContext}"`,
    sub: "This doc page",
    icon: BookOpen,
    prompt: `I'm reading the doc page titled "${pageContext}" in ${kbName}. Can you help me understand it, and answer follow-up questions about it grounded in docs/?`,
  };
}

export function EmptyState({
  onPick,
  pageContext,
}: {
  onPick: (s: AgentStarter) => void;
  pageContext?: string;
}) {
  // Both fall back to the built-in defaults outside an AppConfigProvider, so a
  // route that has not been wrapped still renders (spec 16).
  const app = useAppConfig()?.app;
  const configured = useStarters(AGENT_STARTERS);
  const title = app?.name ?? "Watanabe";
  const tagline = app?.tagline ?? "the team knowledge base";

  // Strictly `=== true`, unlike the `isUnavailable` predicate the disabled
  // controls use. This card is ADDITIVE, so unknown must mean "do not show it":
  // a starter that appears while the probe is in flight and then vanishes is a
  // worse flicker than one that arrives a moment late.
  const { shortFormContent } = useCapabilities();
  const withContent = shortFormContent === true ? [...configured, CONTENT_STARTER] : configured;
  const starters = pageContext ? [pageContextStarter(pageContext, tagline), ...withContent] : withContent;

  return (
    <div className="flex min-h-full flex-col items-center justify-center py-6">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
        <BookOpen className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-[var(--color-ink-strong)]">{title}</p>
      <p className="mt-1 max-w-md text-center text-xs text-[var(--color-ink-muted)]">
        Ask about {tagline}. It reads the docs; it doesn&apos;t write to them.
      </p>

      <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {starters.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-left transition-colors",
                "hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-2)]",
              )}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--color-ink-strong)]">{s.label}</span>
                <span className="block text-xs text-[var(--color-ink-muted)]">{s.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
