/**
 * The stylesheet an exported markdown document carries.
 *
 * Inline, and with no `@import` and no remote font: the exported `.html` has to
 * open from a Downloads folder with no network, and the PDF has to come out the
 * same on every run. A system font stack rather than a bundled family, because a
 * markdown export is a plain document; the bundled families exist for a designed
 * page, which brings its own CSS and does not use this at all.
 *
 * Light-only on purpose. This is print and file output, not a page in the app,
 * and a PDF that follows the render pod's colour scheme would be a surprise.
 */
export const PRINT_STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 3rem 1.5rem 4rem;
  max-width: 46rem;
  background: #fff;
  color: #16161a;
  font: 16px/1.65 ui-serif, Georgia, "Times New Roman", serif;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { line-height: 1.2; margin: 2.2em 0 0.6em; font-weight: 600; letter-spacing: -0.011em; }
h1 { font-size: 2.1rem; margin-top: 0; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.2rem; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1.1em; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.25em 0; }
a { color: #1a4f8a; text-decoration: underline; text-underline-offset: 2px; }
blockquote {
  margin-left: 0; padding: 0.1em 0 0.1em 1.1em;
  border-left: 3px solid #d7d4cd; color: #45454a;
}
hr { border: 0; border-top: 1px solid #e2e0da; margin: 2.4em 0; }
code {
  font: 0.87em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #f3f2ee; border-radius: 4px; padding: 0.12em 0.34em;
}
pre {
  background: #f7f6f3; border: 1px solid #e6e4de; border-radius: 6px;
  padding: 0.9em 1em; overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: 0.85em; }
.md-table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.94em; }
th, td { border: 1px solid #e2e0da; padding: 0.45em 0.7em; text-align: left; vertical-align: top; }
th { background: #f5f4f0; font-weight: 600; }
img, svg { max-width: 100%; height: auto; }
.mermaid { background: none; border: 0; padding: 0; text-align: center; }
@page { margin: 18mm 16mm; }
@media print {
  body { padding: 0; max-width: none; }
  h1, h2, h3 { break-after: avoid; }
  pre, table, blockquote, .mermaid { break-inside: avoid; }
}
`.trim();
