import Link from "next/link";
import { FileText } from "lucide-react";
import { StatusPill } from "./status-pill";
import type { ArtifactStatus } from "@/lib/db/artifacts";
import { formatDate } from "@/lib/ui/date";

export interface ArtifactCard {
  id: string;
  title: string;
  status: ArtifactStatus;
  sourceThreadId: string | null;
  updatedAt: string;
}

function updatedLabel(iso: string): string {
  const formatted = formatDate(iso);
  return formatted ? `Updated ${formatted}` : "";
}

/**
 * The owner's artifacts as a card grid (spec 27). Each card links to the
 * detail/editor view, shows its status pill, a link back to the source thread
 * (when the artifact came from a chat), and the updated time. Presentational:
 * the owner-scoped list is fetched by the server page that renders this.
 */
export function ArtifactGrid({ artifacts }: { artifacts: ArtifactCard[] }) {
  if (artifacts.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing here yet. Promote a document from a chat with the assistant to start an artifact.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {artifacts.map((a) => (
        <li key={a.id}>
          <article
            aria-label={a.title}
            className="flex w-full items-start gap-3 rounded-chip border border-line bg-surface-2 p-3 text-left transition-colors hover:border-accent"
          >
            <FileText className="mt-0.5 size-[18px] shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <Link
                href={`/artifacts/${a.id}`}
                className="block truncate text-[13px] font-semibold text-ink hover:text-accent-ink"
              >
                {a.title}
              </Link>
              <p className="truncate text-xs text-ink-muted">{updatedLabel(a.updatedAt)}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-ink-muted">
                <StatusPill status={a.status} />
                {a.sourceThreadId ? (
                  <Link href={`/chat/${a.sourceThreadId}`} className="truncate hover:text-ink">
                    From chat
                  </Link>
                ) : null}
              </div>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
