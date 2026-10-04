/**
 * Obsidian callouts for the shared prose pipeline.
 *
 * A callout is a blockquote whose first line opens with `[!type]`, optionally a
 * fold marker and a title:
 *
 * ```markdown
 * > [!warning] Do not do this
 * > body text
 * ```
 *
 * `remark-gfm` implements no alert syntax, so until now that rendered as an
 * ordinary blockquote whose first line was the literal string `[!warning] Do not
 * do this`: every callout in the vault read as a typo. This runs in
 * `proseRemarkPlugins` (./shared.tsx) rather than in the KB renderer, so a
 * callout renders identically in a vault note, a chat answer, a shared doc, an
 * artifact, and the canvas.
 *
 * Obsidian's dialect, not GitHub's five alerts: any `[!keyword]` is accepted,
 * authored titles are kept, and a fold marker produces a real `<details>`.
 *
 * Security: structure is emitted through `data.hName` / `data.hProperties`, so
 * no component mapping is needed in either renderer and `rehype-raw` stays
 * absent. `hName` is one of four fixed strings chosen here, never taken from
 * note content, and the keyword reaches the DOM only as the value of
 * `data-callout` (constrained to `[A-Za-z][\w-]*` by the match, then
 * lowercased). It never becomes a class name, so a note cannot author a keyword
 * that injects a class.
 *
 * Typing follows ./mermaid-source.ts: a minimal local shape rather than
 * `@types/mdast`, which is a transitive package pnpm does not hoist.
 */

/** The shape of an mdast tree, to the depth this reads and writes. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/**
 * The opening marker only. The title is NOT captured here: `.` would stop at
 * the first newline but the text node holding the marker usually carries the
 * body too (see `splitInlineAtFirstNewline`), so the marker is sliced off and
 * the title/body cut is made over the inline children instead.
 */
const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

/**
 * Cut a paragraph's inline children at the first line ending, returning
 * `[title, body]`.
 *
 * This is the one genuinely fiddly part. In mdast a soft line break is a `\n`
 * INSIDE a text node, not a node of its own, so
 * `> [!warning] Title\n> body` is a SINGLE paragraph whose text is
 * `[!warning] Title\nbody`: the title and the body are not separate children to
 * pick apart. Any inline siblings before the cut (a `strong`, a `link`) belong
 * to the title, and when the first text node holds no `\n` the title continues
 * through the following siblings until one does.
 *
 * A hard break (`break`, two trailing spaces) ends the line too, and is dropped
 * rather than carried into the body.
 */
export function splitInlineAtFirstNewline(children: MdastNode[]): [MdastNode[], MdastNode[]] {
  const title: MdastNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === "break") return [title, children.slice(i + 1)];

    const value = node.type === "text" ? (node.value ?? "") : "";
    const cut = value.indexOf("\n");
    if (cut === -1) {
      title.push(node);
      continue;
    }

    const head = value.slice(0, cut);
    const tail = value.slice(cut + 1);
    if (head !== "") title.push({ ...node, value: head });
    const body = tail !== "" ? [{ ...node, value: tail }] : [];
    return [title, [...body, ...children.slice(i + 1)]];
  }
  return [title, []];
}

/** `note` -> `Note`, the title Obsidian shows when none is authored. */
function titleCase(keyword: string): string {
  return keyword.charAt(0).toUpperCase() + keyword.slice(1);
}

/**
 * Rewrite one blockquote into a callout, or leave it exactly as it is. Returns
 * nothing: an unrecognized blockquote must come out of the pipeline byte for
 * byte the blockquote it was.
 */
function applyCallout(quote: MdastNode): void {
  const blocks = quote.children ?? [];
  const first = blocks[0];
  if (!first || first.type !== "paragraph" || !first.children?.length) return;

  const lead = first.children[0];
  if (lead.type !== "text" || typeof lead.value !== "string") return;
  const match = MARKER.exec(lead.value);
  if (!match) return;

  const [marker, keyword, fold] = match;
  const type = keyword.toLowerCase();
  const foldable = fold === "+" || fold === "-";

  // Slice the marker off the leading text node, dropping the node entirely when
  // nothing is left of it, so `> [!note]` falls through to the title fallback
  // instead of producing an empty title.
  const head = lead.value.slice(marker.length);
  const rest = first.children.slice(1);
  const [titleInline, bodyInline] = splitInlineAtFirstNewline(
    head === "" ? rest : [{ ...lead, value: head }, ...rest],
  );

  const title: MdastNode = {
    type: "paragraph",
    children: titleInline.length > 0 ? titleInline : [{ type: "text", value: titleCase(type) }],
    data: {
      hName: foldable ? "summary" : "div",
      hProperties: { className: ["callout-title"] },
    },
  };

  const bodyBlocks: MdastNode[] = [
    ...(bodyInline.length > 0 ? [{ type: "paragraph", children: bodyInline }] : []),
    ...blocks.slice(1),
  ];
  const body: MdastNode = {
    type: "blockquote",
    children: bodyBlocks,
    data: { hName: "div", hProperties: { className: ["callout-body"] } },
  };

  quote.children = bodyBlocks.length > 0 ? [title, body] : [title];
  quote.data = {
    hName: foldable ? "details" : "div",
    hProperties: {
      className: ["callout"],
      "data-callout": type,
      // `+` opens, `-` collapses, and the attribute is simply absent for `-`.
      ...(fold === "+" ? { open: true } : {}),
    },
  };
}

/** Depth-first, so a callout nested inside another is rewritten from the inside out. */
function transform(node: MdastNode): void {
  for (const child of node.children ?? []) {
    transform(child);
    if (child.type === "blockquote") applyCallout(child);
  }
}

export function remarkCallouts() {
  return (tree: MdastNode): void => {
    transform(tree);
  };
}
