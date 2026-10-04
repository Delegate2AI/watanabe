"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { richEditorExtensions, markdownStorage } from "@/lib/markdown/rich-extensions";

/**
 * The WYSIWYG half of `BodyEditor`: a ProseMirror surface that reads and writes
 * markdown, so the stored body is the same markdown either mode produces.
 *
 * Only ever rendered for a body `richEditorBlocker` has cleared, because
 * anything the schema cannot hold is gone the moment this serializes back.
 *
 * The editable area carries the `.md` class, so it inherits the same editorial
 * prose styling (app/markdown.css) the read-only renderer uses: what the author
 * types looks like what the reader will get, without a second stylesheet.
 */
export function RichEditor({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  // The markdown this editor last emitted. `value` coming back changed but
  // equal to this is our own keystroke echoing through the parent's state, and
  // re-seeding the document on it would reset the cursor to the top on every
  // character typed.
  const emitted = useRef(value);

  const editor = useEditor({
    extensions: richEditorExtensions,
    content: value,
    editable: !disabled,
    // Required under the App Router: rendering the editor during SSR hydrates
    // against markup the server never produced.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class: "md min-h-40 outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = markdownStorage(editor).getMarkdown();
      emitted.current = markdown;
      onChange(markdown);
    },
  });

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    // `emitUpdate: false`: seeding from outside is not an author edit, and
    // reporting it would write a normalized body back before anyone typed.
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <EditorContent
      editor={editor}
      className="w-full rounded-chip border border-line bg-surface-2 p-3 text-sm text-ink aria-disabled:opacity-60"
      aria-disabled={disabled}
    />
  );
}
