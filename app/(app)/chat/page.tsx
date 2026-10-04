import { headers } from "next/headers";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { resolveIdentity } from "@/lib/identity/resolve";
import { getDb } from "@/lib/db/client";
import { listThreadsForOwner, type ThreadRecord } from "@/lib/db/threads";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = {
  icon: MessageSquare,
  eyebrow: "Chat",
  title: "Your conversations",
  description: "Every thread you have started with Watanabe, scoped to your clearance.",
};

/**
 * The chat index (spec 24), the sidebar's "View all" target. Lists the caller's
 * own threads, pinned first, each linking to its thread view. Identity-scoped by
 * `listThreadsForOwner` (the requester's own email only), so one user's list can
 * never surface another's threads. Resilient: a missing identity yields an empty
 * list rather than a throw (the (app) layout already fail-closes on no identity).
 */
export default async function ChatIndexPage() {
  const identity = await resolveIdentity(await headers());
  const threads = identity ? listThreadsForOwner(getDb(), identity.email) : [];
  const pinned = threads.filter((thread) => thread.pinned);
  const recents = threads.filter((thread) => !thread.pinned);

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={HEADER.icon}
        eyebrow={HEADER.eyebrow}
        title={HEADER.title}
        description={HEADER.description}
      />
      {threads.length === 0 ? (
        <p className="text-sm text-ink-muted">
          You have not started any conversations yet. Start one from the home screen or with New chat.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <ThreadSection title="Pinned" threads={pinned} />
          <ThreadSection title="Recents" threads={recents} />
        </div>
      )}
    </div>
  );
}

function ThreadSection({ title, threads }: { title: string; threads: ThreadRecord[] }) {
  if (threads.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      <ul className="flex flex-col gap-px">
        {threads.map((thread) => (
          <li key={thread.sdkSessionId}>
            <Link
              href={`/chat/${thread.sdkSessionId}`}
              className="flex items-center justify-between gap-4 rounded-menu px-3 py-2 hover:bg-surface-hover"
            >
              <span className="truncate text-[13.5px] font-medium text-ink">
                {thread.title ?? "New chat"}
              </span>
              <time
                dateTime={thread.updatedAt}
                title={formatDateTime(thread.updatedAt)}
                className="shrink-0 text-xs text-ink-faint"
              >
                {formatRelative(thread.updatedAt)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
