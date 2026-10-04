/**
 * The editable half of the design guidance: art direction only.
 *
 * An admin can replace all of this from `/admin/design`, which is why it is
 * separated from `./design-prompt.ts`. Nothing here is load-bearing for the
 * renderer. Delete the palette section and documents get uglier; delete a line
 * from DESIGN_CONSTRAINTS and they stop working, weeks later, with nothing
 * connecting the two.
 *
 * A leaf module with no imports, on purpose: the design-guide store reads this
 * constant for its fallback and `./design-prompt.ts` reads the store, so
 * putting the default anywhere else would close a cycle.
 */

/**
 * The families baked into the render sidecar image
 * (scripts/doc-render/fetch-fonts.mjs). Named here as well so the two lists are
 * visibly the same thing, and asserted equal by the sibling test.
 */
export const BUNDLED_FONTS = ["Fraunces", "Source Serif 4", "JetBrains Mono", "Inter"] as const;

export const DEFAULT_DESIGN_HOUSE_STYLE = [
  "HOUSE STYLE",
  "",
  "A default-styled page reads as unfinished. Build a small system at the top of",
  "the <style> block and use it consistently.",
  "",
  "PALETTE. CSS custom properties on :root: a paper background, an ink colour, a",
  "muted grey, ONE accent, and one deep colour for inverted sections. Five or six",
  "values, not a rainbow.",
  "",
  "TYPE. Real contrast between three roles: a display face for headings",
  "(Fraunces), a reading face for body text (Source Serif 4), and a mono face for",
  "labels and small caps (JetBrains Mono, letter-spaced and uppercased).",
  "",
  "STRUCTURE.",
  "- A masthead: the document's name, a kicker line, a rule, then a title and a",
  "  standfirst paragraph one size up from the body.",
  "- Numbered or named sections, each with a small mono eyebrow above its heading.",
  "- A closing band and a small colophon line.",
  "- Constrain the reading column to roughly 40 to 48rem and let inverted bands",
  "  run full width.",
  "",
  "RHYTHM. Break the run of paragraphs with the shapes the content actually",
  "wants: a full-bleed inverted band on the deep colour for the one section that",
  "matters most, a key-value grid for metadata, a bordered row of short cards, a",
  "pull quote in the display face, a callout with an accent left border, a",
  "bordered table of figures. Use two or three per document, not all of them.",
  "",
  "FIGURES AND CHARTS. A designed document earns its format on its figures, so",
  "draw them rather than describing them.",
  "- Draw every chart by hand as inline <svg>: bar and column comparisons, radar",
  "  plots, timelines, simple schematics. It is the only figure that appears",
  "  everywhere. It renders in the reader's preview pane, in the PDF and in the",
  "  downloaded file, and its aria-label becomes the caption in the markdown copy.",
  "- Give each <svg> role=\"img\", an aria-label describing what it shows, and a",
  "  viewBox with no fixed pixel height, so it scales to the column and to the",
  "  printed page.",
  "- Label it. Name the axes, put the value on each bar, point or slice, and give",
  "  the figure a caption. A chart a reader has to guess at is decoration.",
  "- Take a figure's colours from the palette variables, and never let colour be",
  "  the only thing carrying a distinction: label the series as well.",
  "- Mermaid: a <pre class=\"mermaid\"> block is drawn at EXPORT time only. In the",
  "  preview pane it shows as its own source, because that pane runs no script.",
  "  Use it only for a genuine flowchart, sequence or state diagram, and prefer",
  "  hand-drawn SVG for anything the reader should see immediately.",
  "- Never draw a number you were not given. If a figure is illustrative rather",
  "  than measured, say so on the figure itself.",
  "- Never describe a diagram you did not draw.",
  "",
  "PRINT. The document is also printed to PDF. Keep backgrounds explicit (they",
  "are printed), avoid fixed heights, and let long tables and code blocks break",
  "across pages.",
].join("\n");
