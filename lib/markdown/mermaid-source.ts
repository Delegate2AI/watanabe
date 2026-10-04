/**
 * Recognizes a ```mermaid fenced block in the parsed tree, so the shared prose
 * pipeline can route it to the diagram renderer instead of a code block.
 *
 * Reads the hast node react-markdown hands a component rather than walking
 * React children. By the time a `pre` component renders, its `code` child is
 * already a React element and recovering the source from it means reaching
 * through `props.children` and hoping nothing transformed it. The `node` prop is
 * the parsed source itself, which is both simpler and exact.
 *
 * Deliberately mirrors `./highlight.ts`: the same `language-` / `lang-` prefix
 * pair, the same loose hast typing (a real `Root` type would mean depending on
 * `@types/hast`, a transitive package pnpm does not hoist), and the same
 * text-concatenation walk. `mermaid` is not a registered lowlight grammar, so
 * `highlightCode` leaves these blocks alone and their children are still plain
 * source text when this runs.
 */

/** The shape of a hast tree, to the depth this reads. */
interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

const MERMAID = "mermaid";

/** The language a code element declares, or null. Matches both emitted prefixes. */
function declaredLanguage(node: HastNode): string | null {
  const list = node.properties?.className;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const value = String(entry);
    if (value.startsWith("lang-")) return value.slice(5);
    if (value.startsWith("language-")) return value.slice(9);
  }
  return null;
}

/** The concatenated text of a subtree, which for a code block is its source. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/**
 * The mermaid source inside a `pre` node, or null when it is an ordinary code
 * block. Null is the signal to render a plain `<pre>`, so anything unexpected
 * degrades to today's behaviour rather than to an error.
 *
 * An empty or whitespace-only fence returns null too: mermaid throws on empty
 * input, and a blank diagram is not worth a rendering surface.
 */
export function mermaidSourceOf(node: unknown): string | null {
  const pre = node as HastNode | undefined;
  if (!pre || pre.tagName !== "pre") return null;
  const children = (pre.children ?? []).filter((child) => child.type === "element");
  if (children.length !== 1) return null;
  const code = children[0];
  if (code.tagName !== "code") return null;
  if (declaredLanguage(code) !== MERMAID) return null;
  const source = textOf(code).trim();
  return source.length > 0 ? source : null;
}
