import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { MarkdownStorage } from "tiptap-markdown";

/**
 * The schema behind the rich (WYSIWYG) editor, in one place so the component
 * and `rich-fidelity.roundtrip.test.ts` can never drift apart: the test's whole
 * value is that it measures the editor the UI actually renders.
 *
 * StarterKit covers headings, emphasis, links, lists, quotes, rules, hard
 * breaks and code blocks. It does NOT cover tables, images, checklists or raw
 * HTML, which is what `richEditorBlocker` exists to keep out of rich mode.
 *
 * `html: false` on purpose. With HTML parsing on, markdown-it hands the editor
 * tags the schema cannot hold, so `<div class="x">raw</div>` comes back as the
 * bare word `raw`: the loss looks like a successful edit. Off, the same input
 * is inert text, and the blocker refuses the body outright.
 */
export const richEditorExtensions = [
  StarterKit,
  Markdown.configure({ html: false, linkify: false, breaks: false }),
];

/**
 * `editor.storage.markdown`, typed. TipTap's storage bag is `Record<string,
 * unknown>` by extension name, so every caller would otherwise repeat the same
 * cast to reach the serializer.
 */
export function markdownStorage(editor: Editor): MarkdownStorage {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;
}
