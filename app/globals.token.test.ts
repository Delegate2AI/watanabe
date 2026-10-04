import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-level token contract for the spec 18 design system.
 *
 * Why source-level and not a rendered probe: jsdom does not evaluate
 * `@media (prefers-color-scheme)` and does not cascade CSS custom properties
 * through `getComputedStyle`, so a runtime "the accent flipped" assertion would
 * be unreliable. Instead we assert the structural guarantees that make the
 * theme correct: the variables are declared, `data-theme` redefines them, and
 * the `data-theme` overrides come AFTER the media query so an explicit choice
 * beats `prefers-color-scheme` in both directions.
 */
const tokens = readFileSync(
  path.resolve(__dirname, "design-tokens.css"),
  "utf8",
);
const globals = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

function blockBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  // Balance braces so a nested block (`@media { :root { ... } }`) is captured
  // whole rather than truncated at the first inner `}`.
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced block for ${selector}`);
}

describe("design tokens", () => {
  it("declares --accent and --surface on :root (light default)", () => {
    const root = blockBody(tokens, ":root {");
    expect(root).toMatch(/--accent:\s*#c96442/i);
    expect(root).toMatch(/--surface:\s*#ffffff/i);
  });

  it("redefines --accent and --surface under prefers-color-scheme: dark", () => {
    const media = blockBody(tokens, "@media (prefers-color-scheme: dark)");
    expect(media).toMatch(/--accent:\s*#d97757/i);
    expect(media).toMatch(/--surface:\s*#302e2b/i);
  });

  it("provides data-theme overrides for both light and dark", () => {
    const dark = blockBody(tokens, '[data-theme="dark"]');
    expect(dark).toMatch(/--accent:\s*#d97757/i);
    expect(dark).toMatch(/--surface:\s*#302e2b/i);
    const light = blockBody(tokens, '[data-theme="light"]');
    expect(light).toMatch(/--accent:\s*#c96442/i);
    expect(light).toMatch(/--surface:\s*#ffffff/i);
  });

  it("orders data-theme overrides AFTER the media query so the toggle wins", () => {
    const mediaAt = tokens.indexOf("@media (prefers-color-scheme: dark)");
    const darkAt = tokens.indexOf('[data-theme="dark"]');
    const lightAt = tokens.indexOf('[data-theme="light"]');
    expect(mediaAt).toBeGreaterThanOrEqual(0);
    expect(darkAt).toBeGreaterThan(mediaAt);
    expect(lightAt).toBeGreaterThan(mediaAt);
  });

  it("gives the agent --color-* palette data-theme overrides too", () => {
    // Without these the palette tracked only `prefers-color-scheme`, so shell
    // surfaces reading it (citation chips, skeletons, the /kb chat panel) went
    // dark for an OS-dark reader who had chosen the Light theme.
    const dark = blockBody(globals, ':root[data-theme="dark"]');
    expect(dark).toMatch(/--color-surface-2:\s*#17191c/i);
    expect(dark).toMatch(/--color-accent:\s*#2fe3a3/i);
    const light = blockBody(globals, ':root[data-theme="light"]');
    expect(light).toMatch(/--color-surface-2:\s*#f4f5f6/i);
    expect(light).toMatch(/--color-accent:\s*#0f8a5f/i);

    const mediaAt = globals.indexOf("@media (prefers-color-scheme: dark)");
    expect(globals.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(mediaAt);
    expect(globals.indexOf(':root[data-theme="light"]')).toBeGreaterThan(mediaAt);
  });

  it("maps the tokens into Tailwind utilities via @theme inline", () => {
    const theme = blockBody(globals, "@theme inline {");
    expect(theme).toMatch(/--color-accent:\s*var\(--accent\)/);
    expect(theme).toMatch(/--color-surface:\s*var\(--surface\)/);
    expect(theme).toMatch(/--color-ink-muted:\s*var\(--ink-muted\)/);
    expect(theme).toMatch(/--color-line:\s*var\(--line\)/);
  });

  it("defines the full radius scale as tokens (no arbitrary radii)", () => {
    const root = blockBody(tokens, ":root {");
    const theme = blockBody(globals, "@theme inline {");
    for (const [name, value] of [
      ["tab", "6px"],
      ["icon", "7px"],
      ["control", "8px"],
      ["send", "9px"],
      ["menu", "10px"],
      ["chip", "11px"],
      ["card", "13px"],
      ["composer", "18px"],
    ] as const) {
      expect(root).toMatch(new RegExp(`--radius-${name}:\\s*${value}`));
      expect(theme).toMatch(
        new RegExp(`--radius-${name}:\\s*var\\(--radius-${name}\\)`),
      );
    }
  });

  it("maps both elevation shadows as named utilities", () => {
    const theme = blockBody(globals, "@theme inline {");
    expect(theme).toMatch(/--shadow-card:\s*var\(--shadow-card\)/);
    expect(theme).toMatch(/--shadow-elevated:\s*var\(--shadow\)/);
  });

  it("gives portaled Radix content its own accent focus ring", () => {
    // Radix Sheet/Dialog/DropdownMenu/Tooltip portal outside `.app-shell`, so
    // the shell ring cannot reach them; there must be a data-slot rule too.
    for (const slot of [
      "sheet-content",
      "dialog-content",
      "dropdown-menu-content",
      "tooltip-content",
    ]) {
      expect(tokens).toContain(`[data-slot="${slot}"] :focus-visible`);
    }
    const ring = blockBody(
      tokens,
      '[data-slot="sheet-content"] :focus-visible',
    );
    expect(ring).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it("honors prefers-reduced-motion for the shell and portaled content", () => {
    const rm = blockBody(tokens, "@media (prefers-reduced-motion: reduce)");
    expect(rm).toContain(".app-shell *");
    expect(rm).toContain("[data-slot] *");
    expect(rm).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(rm).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});
