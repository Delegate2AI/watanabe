import { Eye, MessageSquare } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { HtmlDocument } from "@/components/ui/html-document";
import type { DocFormat } from "@/lib/documents/types";
import type { DocComment, LinkAccess } from "@/lib/shared-docs/types";

/**
 * The read-only external (token-authed) rendering of a shared doc (spec 28).
 * This is reached WITHOUT a session, so it is strictly capability-limited: it
 * shows the title, an access badge, the rendered body, and (for a comment link)
 * the existing thread. It deliberately exposes NO owner-only or edit affordance,
 * no share manager, no version controls, and not the owner's email.
 */
export function ExternalDocView({
  title,
  body,
  format = "md",
  access,
  comments,
}: {
  title: string;
  body: string;
  /**
   * An HTML body is a whole designed page and goes to the framed renderer. It
   * matters most here: this surface is reached with no session at all, and the
   * body was written by whoever authored the document, not by the reader.
   */
  format?: DocFormat;
  access: LinkAccess;
  comments: DocComment[];
}) {
  const Icon = access === "comment" ? MessageSquare : Eye;
  const label = access === "comment" ? "Shared with you: can comment" : "Shared with you: can view";
  return (
    <div className="mx-auto max-w-3xl px-6 pb-16 pt-12">
      <div className="mb-6 flex items-center gap-2 text-xs text-ink-muted">
        <Icon className="size-4 text-accent" aria-hidden />
        <span>{label}</span>
      </div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{title}</h1>
      {format === "html" ? (
        <div className="h-[75vh] min-h-96 overflow-hidden rounded-card border border-line bg-surface-2">
          <HtmlDocument html={body} title={title} />
        </div>
      ) : (
        <article className="rounded-card border border-line bg-surface-2 p-6">
          <Markdown>{body}</Markdown>
        </article>
      )}
      {access === "comment" && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink">Comments</h2>
          {comments.length === 0 ? (
            <p className="text-sm text-ink-muted">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map((c) => (
                <li key={c.id} className="rounded-chip border border-line bg-surface-2 p-3 text-sm">
                  <span className="block text-ink">{c.body}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The throttle state, shown identically for a valid or invalid token. */
export function ExternalThrottled() {
  return (
    <div className="mx-auto max-w-md px-6 pb-16 pt-24 text-center">
      <h1 className="mb-2 text-lg font-semibold text-ink">Too many requests</h1>
      <p className="text-sm text-ink-muted">Please wait a moment and try this link again.</p>
    </div>
  );
}
