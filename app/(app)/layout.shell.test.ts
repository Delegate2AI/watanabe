import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-level layout contract for the shell grid.
 *
 * Why source-level and not a rendered probe: jsdom implements no layout engine,
 * so `getBoundingClientRect()` returns zeroes and grid track sizing is never
 * computed. A runtime "the sidebar fills the viewport" assertion would pass
 * against any markup at all, including the broken markup this guards. The same
 * reasoning is why app/globals.token.test.ts asserts its token contract against
 * the stylesheet source. This asserts the structural guarantee instead: the grid
 * declares exactly one row.
 *
 * The bug this locks down: sonner's <Toaster /> always renders a static
 * <section> wrapper, which is an in-flow grid item and auto-places into a second
 * row. With no explicit row track both rows size to `auto`, and `align-content:
 * normal` (stretch) splits the leftover viewport height between them, so the
 * sidebar and main frame were left far short of full height and the shell's own
 * background showed through underneath. It only reproduced when the viewport was
 * taller than the sidebar's intrinsic content, so ordinary window sizes hid it.
 */
const layout = readFileSync(path.resolve(__dirname, "layout.tsx"), "utf8");

/** The class list on the `.app-shell` element. */
function shellClassName(): string {
  const match = layout.match(/className="(app-shell[^"]*)"/);
  expect(match, "no element with an `app-shell` className found").not.toBeNull();
  return match![1];
}

describe("app shell grid", () => {
  it("pins the grid to a single row so a stray in-flow child cannot steal height", () => {
    expect(shellClassName()).toMatch(/\bgrid-rows-1\b/);
  });

  it("still declares the two-column track and the full-viewport height", () => {
    const cls = shellClassName();
    expect(cls).toMatch(/\bgrid\b/);
    expect(cls).toMatch(/\bh-screen\b/);
    expect(cls).toMatch(/\bgrid-cols-\[264px_1fr\]/);
    expect(cls).toMatch(/max-\[860px\]:grid-cols-1/);
  });

  it("keeps the toast surface inside .app-shell, where the scoped CSS reaches it", () => {
    // The accent focus ring and the reduced-motion rule in design-tokens.css are
    // both scoped to `.app-shell` descendants, and sonner renders toasts in
    // place rather than portaling them to <body>. Hoisting <Toaster /> out of
    // the shell would silently drop both from every toast, so the fix for the
    // row bug must not be "move it out".
    // Match the rendered element on its own line rather than the prose: the
    // comment explaining this fix also mentions `<Toaster />`, and it sits
    // ABOVE the shell element.
    const shellOpen = layout.search(/className="app-shell/);
    const toaster = layout.search(/^\s*<Toaster \/>\s*$/m);
    expect(shellOpen).toBeGreaterThanOrEqual(0);
    expect(toaster, "no rendered <Toaster /> element found").toBeGreaterThan(
      shellOpen,
    );
  });
});
