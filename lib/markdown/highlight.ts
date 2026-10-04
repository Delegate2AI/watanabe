import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Fenced-code syntax highlighting, carrying only the grammars this app renders.
 *
 * This is `rehype-highlight` with one thing changed: which languages ship. That
 * plugin takes a `languages` option, but its module does
 * `import {common} from 'lowlight'` and falls back to it (`settings.languages ||
 * common`), so the reference is live and all 37 common grammars land in the
 * bundle whatever you pass. They were the single largest thing in the first
 * client chunk of every route that renders prose: chat, docs, artifacts, canvas.
 *
 * Going through `createLowlight` directly instead means the registry holds
 * exactly the map below, roughly a third of the source. The behaviour is
 * `rehype-highlight`'s own defaults as this app configured them: no language
 * class means no highlighting (never guess a grammar), an unregistered language
 * renders plainly instead of throwing, and only fenced blocks (`pre > code`) are
 * touched, so inline code is left alone. It reads the already-parsed code text
 * and never re-enables raw HTML, so the KB renderer's strict no-`rehype-raw`
 * posture (spec 25) is preserved.
 *
 * Aliases come along for free: lowlight registers each grammar's own alias list,
 * so `ts`, `js`, `sh`, `yml`, `html`, and `toml` keep working. Add a grammar
 * here when a language starts showing up unhighlighted; the cost is that
 * language's source and nothing else.
 */
const lowlight = createLowlight({
  bash,
  css,
  diff,
  ini,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

/** The shape of a hast tree, to the depth this plugin actually reads. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** The class name marking a block as deliberately unhighlighted. */
const NO_HIGHLIGHT = new Set(["no-highlight", "nohighlight"]);

/**
 * The language a code element declares, `null` for none, `false` for an explicit
 * opt-out. Matches both prefixes remark/rehype emit (`language-` and `lang-`).
 */
function declaredLanguage(node: HastNode): string | null | false {
  const list = node.properties?.className;
  if (!Array.isArray(list)) return null;
  let name: string | null = null;
  for (const entry of list) {
    const value = String(entry);
    if (NO_HIGHLIGHT.has(value)) return false;
    if (!name && value.startsWith("lang-")) name = value.slice(5);
    if (!name && value.startsWith("language-")) name = value.slice(9);
  }
  return name;
}

/** The concatenated text of a subtree, which for a code block is its source. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Highlight one `<code>`, in place, when its language is one we carry. */
function highlightCode(code: HastNode): void {
  const lang = declaredLanguage(code);
  if (!lang || !lowlight.registered(lang)) return;

  const result = lowlight.highlight(lang, textOf(code));
  const classes = Array.isArray(code.properties?.className)
    ? (code.properties.className as unknown[])
    : [];
  if (!classes.includes("hljs")) classes.unshift("hljs");
  code.properties = { ...code.properties, className: classes };
  if (result.children.length > 0) code.children = result.children as unknown as HastNode[];
}

/** Walk the tree, highlighting every `pre > code` and nothing else. */
function visit(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (node.tagName === "pre" && child.type === "element" && child.tagName === "code") {
      highlightCode(child);
      continue; // its children are highlighted markup now, not source to walk
    }
    visit(child);
  }
}

/**
 * The rehype plugin. Typed loosely on purpose: a hast `Root` type would mean
 * depending on `@types/hast`, which is a transitive package and not hoisted
 * under pnpm (the same trap `shared.tsx` documents for `unified`).
 */
export function rehypeHighlightSubset() {
  return (tree: unknown): void => visit(tree as HastNode);
}
