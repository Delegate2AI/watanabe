/**
 * Bridge between the rendered DOM and the character offsets a TextAnchor uses.
 * All functions walk only Text nodes under `root` in document order, so the
 * offset space is exactly `plainTextOf(root)`. Client-only (needs the DOM).
 */

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

/** The concatenated text content of `root`, the offset space anchors live in. */
export function plainTextOf(root: HTMLElement): string {
  return textNodes(root).map((n) => n.data).join("");
}

/** Map a global char offset to a specific `{ node, offset }` within `root`. */
function locate(root: HTMLElement, target: number): { node: Text; offset: number } | null {
  let acc = 0;
  for (const node of textNodes(root)) {
    const len = node.data.length;
    if (target <= acc + len) return { node, offset: target - acc };
    acc += len;
  }
  return null;
}

/** A DOM Range for `[start, end)` in the plaintext, or null if out of range. */
export function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end < start) return null;
  const from = locate(root, start);
  const to = locate(root, end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Convert the live selection (if it is inside `root`) to plaintext offsets. */
export function offsetsFromSelection(root: HTMLElement, selection: Selection): { start: number; end: number } | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function offsetOf(root: HTMLElement, container: Node, within: number): number | null {
  let acc = 0;
  for (const node of textNodes(root)) {
    if (node === container) return acc + within;
    acc += node.data.length;
  }
  // A non-text container (e.g. an element boundary): fall back to null so callers ignore it.
  return null;
}
