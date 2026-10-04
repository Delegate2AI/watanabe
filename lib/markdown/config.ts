import { isFlagEnabled } from "@/lib/config/flags";

/**
 * The rich (WYSIWYG) body editor. Off, every edit surface keeps exactly the
 * raw-markdown textarea it has always had and no ProseMirror code is fetched at
 * all, so flag-off leaves every existing byte-path identical.
 *
 * Read on the server and passed down as a prop: the edit surfaces are client
 * components, which cannot see the flag environment themselves.
 */
export function isRichEditorEnabled(): boolean {
  return isFlagEnabled("RICH_EDITOR_ENABLED");
}
