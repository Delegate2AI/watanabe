import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkCallouts } from "./callouts";
import { rehypeHighlightSubset } from "./highlight";
import { mermaidSourceOf } from "./mermaid-source";
import { MermaidDiagram } from "@/components/ui/mermaid";

/**
 * Shared markdown pipeline for both renderers: the client `<Markdown>`
 * (components/ui/markdown.tsx) and the server KB renderer (lib/kb/markdown.tsx).
 * Keeping the plugin list and the table wrapper in one place is what makes the
 * two renderers render prose identically; each still layers its own `a` / `code`
 * overrides on top for citation links and wikilinks.
 *
 * This module has no `"use client"` directive and uses no hooks, so it imports
 * cleanly into the Server Component renderer as well as the client one.
 */

// Derive the plugin-list type from the component's own props so we never import
// `unified` directly (it is a transitive dep and not hoisted under pnpm).
type MarkdownProps = ComponentProps<typeof ReactMarkdown>;

/**
 * GitHub-flavored markdown: tables, task lists, strikethrough, autolinks. Plus
 * Obsidian callouts (./callouts.ts), which no GFM extension covers and which
 * otherwise render as a blockquote whose first line is the literal text
 * `[!warning]`.
 */
export const proseRemarkPlugins: MarkdownProps["remarkPlugins"] = [remarkGfm, remarkCallouts];

/**
 * Drop raw HTML instead of printing it. Both renderers deliberately omit
 * `rehype-raw`, so authored HTML is never *executed*, but react-markdown's
 * default is to render the raw source as escaped text: an HTML comment
 * (`<!-- ... -->`) came out as visible literal text in the reader, which is the
 * one thing a comment is supposed to never do. Vault notes carry metadata
 * blocks in comments (KB-TAG headers), so this is the common case, not an edge
 * one. `skipHtml` drops every raw HTML node, comments and tags alike; a tag
 * such as `<br>` was already inert escaped text, so nothing that used to render
 * stops rendering.
 */
export const proseSkipHtml = true;

/**
 * Fenced-code syntax highlighting. See ./highlight.ts for what it registers and
 * why it is not `rehype-highlight` itself.
 */
export const proseRehypePlugins: MarkdownProps["rehypePlugins"] = [rehypeHighlightSubset];

/**
 * Overrides shared by both renderers. The `table` wrapper puts each table in a
 * horizontal-scroll container so a wide table scrolls on its own instead of
 * forcing the whole page wide, replacing the old `display:block` hack on the
 * table element itself.
 */
export const proseSharedComponents: Components = {
  // Only `children` is forwarded: GFM alignment lives on the `th`/`td` cells,
  // not the table element, so the table needs no other props. This also avoids
  // spreading react-markdown's `node` prop onto a DOM element.
  table({ children }) {
    return (
      <div className="md-table">
        <table>{children}</table>
      </div>
    );
  },
  /**
   * A ```mermaid fence becomes a diagram; every other fenced block stays the
   * `<pre>` it already was.
   *
   * Hooked at `pre` rather than `code` because both renderers already override
   * `code` for their own citation and wikilink handling, and a third override
   * competing for that slot would mean each renderer remembering to compose it.
   * `pre` is unclaimed, and a fenced block is always `pre > code`, so one
   * override here reaches the client `<Markdown>` and the server KB view alike.
   *
   * `mermaidSourceOf` reads the hast node, not the rendered children, so the
   * source arrives exactly as authored. It returns null for anything that is
   * not a non-empty mermaid fence, which is what keeps this a no-op for the
   * rest of the app's code blocks.
   */
  pre({ node, children }) {
    const chart = mermaidSourceOf(node);
    return chart ? <MermaidDiagram chart={chart} /> : <pre>{children}</pre>;
  },
};
