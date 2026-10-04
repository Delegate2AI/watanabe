import { cn } from "@/lib/utils";
import type { ArtifactStatus } from "@/lib/db/artifacts";

const STEPS: { status: ArtifactStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "ready", label: "Ready" },
  { status: "in_review", label: "In review" },
  { status: "published", label: "Published" },
];

/**
 * The route from a draft to a note in the knowledge base, with the artifact's
 * own position on it.
 *
 * The panel used to show one button and no map, so an owner looking at a draft
 * could see "Mark ready" without any way to tell that publishing was a
 * multi-step path, how far along they were, or what was left. Naming all four
 * states makes the remaining distance legible before anything is clicked.
 *
 * Presentational: reads the status, renders nothing interactive.
 */
export function PublishSteps({ status }: { status: ArtifactStatus }) {
  const current = STEPS.findIndex((step) => step.status === status);
  return (
    <ol className="mb-3 flex flex-wrap items-center gap-1 text-xs" aria-label="Publishing steps">
      {STEPS.map((step, i) => (
        <li
          key={step.status}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "rounded-full px-2 py-0.5",
            i === current && "bg-accent-soft font-medium text-accent-ink",
            i < current && "text-ink-muted",
            i > current && "text-ink-faint",
          )}
        >
          {step.label}
        </li>
      ))}
    </ol>
  );
}
