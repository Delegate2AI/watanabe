"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { cn } from "@/lib/utils";
import { kbDocHref } from "@/lib/kb/doc-path";
import {
  proseRehypePlugins,
  proseRemarkPlugins,
  proseSharedComponents,
  proseSkipHtml,
} from "@/lib/markdown/shared";

/**
 * Inline code that looks like a KB citation path (e.g.
 * `00-overview/executive-summary.md`) becomes a link to that document's `/kb`
 * route, so a reader can open the cited doc in place. Linking is optimistic and
 * clearance-safe (see `kbDocHref`): a path the reader is not cleared for 404s on
 * click, exactly like typing the URL. Any other inline code renders as a plain
 * code span.
 *
 * Defined at module scope, not inline in the component below. An inline
 * `components={{...}}` object is a new object holding a new function on every
 * render, which react-markdown reads as an entirely new component map: it
 * remounts every code span in the document rather than updating it. Hoisting
 * makes the map a stable identity for the life of the module.
 */
function CitationCode({ className, children }: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  const text = String(children).trim();
  const href = className ? null : kbDocHref(text);
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          // Themed through the `--prose-*` tokens, never the agent chat's
          // `--color-*` set: those only switch on `prefers-color-scheme`, so an
          // OS-dark reader who picked the light theme got a black chip on a
          // cream page. `--prose-*` follows `data-theme` in the shell and is
          // remapped to the agent palette under `.agent-chat` (markdown.css).
          "citation-path rounded-md border border-[var(--prose-line)] bg-[var(--prose-surface)]",
          "px-1.5 py-0.5 font-mono text-[0.82em] text-[var(--prose-accent)] underline-offset-2 hover:underline",
        )}
        title={`Open ${text}`}
      >
        {text}
      </Link>
    );
  }
  // Only `className` and `children` are forwarded. The only other prop
  // react-markdown passes a code span is `node` (its hast node), and putting
  // that on a DOM element is an unknown-attribute warning, never markup.
  return <code className={className}>{children}</code>;
}

/** The shared prose overrides plus this renderer's citation-aware code span. */
const proseComponents: Components = { ...proseSharedComponents, code: CitationCode };

/**
 * Renders markdown with the `.md` style scope (see globals.css).
 *
 * Memoized on `children`, which is what makes streaming affordable. A chat
 * transcript re-renders on every token of the answer being written; without this
 * boundary every settled turn re-ran the full remark/rehype pipeline (parse,
 * GFM, syntax highlight, hast-to-React) on text that had not changed, so the
 * per-token cost grew with the length of the conversation. The prop is a plain
 * string, so the default shallow comparison is exactly the right one.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={proseRemarkPlugins}
        rehypePlugins={proseRehypePlugins}
        components={proseComponents}
        skipHtml={proseSkipHtml}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
