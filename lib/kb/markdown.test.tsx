// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "./markdown";

/** Render the markdown element tree to an HTML string for assertions. */
function html(body: string, options?: Parameters<typeof renderMarkdown>[1]): string {
  return renderToStaticMarkup(renderMarkdown(body, options));
}

describe("renderMarkdown", () => {
  it("renders headings, lists, emphasis, and code", () => {
    const out = html("# Title\n\n- one\n- two\n\n**bold** and `code`");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
  });

  it("renders GFM tables inside the horizontal-scroll wrapper", () => {
    const out = html("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(out).toContain('class="md-table"');
    expect(out).toContain("<table>");
    expect(out).toContain("<td>1</td>");
  });

  it("hides an HTML comment instead of printing it as text", () => {
    const out = html("<!-- KB-TAG v1\nkb.id: MERIDIAN-SCORE-SHIP-1\n-->\n\nvisible prose <!-- inline note --> continues");
    expect(out).not.toContain("KB-TAG");
    expect(out).not.toContain("inline note");
    expect(out).toContain("visible prose");
  });

  it("syntax-highlights a fenced code block", () => {
    const out = html("```js\nconst x = 1;\n```");
    // The highlighter runs server-side too, tagging tokens we theme via CSS.
    expect(out).toContain("hljs");
    expect(out).toContain("hljs-keyword");
  });

  it("never emits a live <script> element from note content", () => {
    const out = html("hello\n\n<script>window.stolen = document.cookie</script>\n\nworld");
    // No executable script element: raw HTML is dropped or escaped, never rendered.
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("never emits a live <img onerror> element", () => {
    const out = html('before\n\n<img src=x onerror="alert(1)">\n\nafter');
    // The injection survives only as inert, escaped text (&lt;img ...&gt;), not a real element.
    expect(out.toLowerCase()).not.toContain("<img");
  });

  it("neutralizes a javascript: link URL", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out.toLowerCase()).not.toContain("javascript:alert");
  });

  it("rewrites an internal .md link to a /kb route", () => {
    const out = html("[Vision](./product-vision.md)", {
      currentDirSlug: ["00-overview"],
    });
    expect(out).toContain('href="/kb/00-overview/product-vision"');
  });

  it("leaves an external link untouched", () => {
    const out = html("[home](https://example.com/page)");
    expect(out).toContain('href="https://example.com/page"');
  });

  it("points an embedded image at the resolved asset's byte route", () => {
    const out = html("![diagram](Diagram.png)", {
      resolveAsset: (src) => (src === "Diagram.png" ? "assets/charts/Diagram.png" : null),
    });
    expect(out).toContain('src="/api/kb/asset/assets/charts/Diagram.png"');
    expect(out).toContain('alt="diagram"');
  });

  it("leaves an image src untouched when the asset does not resolve", () => {
    // Unresolved (or no resolver): the authored src is preserved, not rewritten.
    expect(html("![d](https://cdn.example.com/x.png)", { resolveAsset: () => null })).toContain(
      'src="https://cdn.example.com/x.png"',
    );
    expect(html("![d](/kb/assets/x.png)")).toContain('src="/kb/assets/x.png"');
  });

  /**
   * End to end for the embed fix: `![[...]]` used to keep its `!` through the
   * wikilink rewrite, so an asset embed printed as the literal text
   * `!Diagram.png` and a note embed became an `<img>` pointing at an HTML route.
   */
  it("renders an asset embed as a real image on the byte route", () => {
    const out = html("![[Diagram.png]]", {
      resolveWikilink: () => null,
      resolveAsset: (src) => (src === "Diagram.png" ? "assets/charts/Diagram.png" : null),
    });
    expect(out).toContain('src="/api/kb/asset/assets/charts/Diagram.png"');
    expect(out).not.toContain("!Diagram.png");
  });

  it("renders a note embed as a link, never as an image pointing at an HTML route", () => {
    const out = html("![[Product Vision]]", {
      resolveWikilink: (t) => (t === "Product Vision" ? "00-overview/product-vision" : null),
      resolveAsset: () => null,
    });
    expect(out).toContain('href="/kb/00-overview/product-vision"');
    expect(out.toLowerCase()).not.toContain("<img");
  });

  it("renders an unresolvable embed as inert text, not a broken image", () => {
    const out = html("![[secret.png]]", { resolveWikilink: () => null, resolveAsset: () => null });
    expect(out.toLowerCase()).not.toContain("<img");
    expect(out).not.toContain("!");
    expect(out).toContain("secret.png");
  });

  it("links an inline code span that names a KB document", () => {
    const out = html("See `00-overview/executive-summary.md` for the pitch.");
    expect(out).toContain('href="/kb/00-overview/executive-summary"');
    // It is a link, not a bare code span, for that token.
    expect(out).not.toContain("<code>00-overview/executive-summary.md</code>");
  });

  it("leaves a non-path code span as plain code", () => {
    const out = html("run `pnpm dev` to start");
    expect(out).toContain("<code>pnpm dev</code>");
  });

  it("drops a leading H1 that repeats the note title, which the page header already renders", () => {
    const out = html("# Emission Design\n\nEmission curves are set annually.", {
      title: "Emission Design",
    });
    expect(out).not.toContain("<h1>");
    expect(out).toContain("Emission curves are set annually.");
  });

  it("ignores surrounding whitespace when comparing the leading H1 to the title", () => {
    const out = html("\n\n#   Emission   Design  \n\nBody.", { title: " Emission Design " });
    expect(out).not.toContain("<h1>");
  });

  it("keeps a leading H1 that differs from the title, including by case", () => {
    expect(html("# Emission Curves\n\nBody.", { title: "Emission Design" })).toContain(
      "<h1>Emission Curves</h1>",
    );
    expect(html("# emission design\n\nBody.", { title: "Emission Design" })).toContain(
      "<h1>emission design</h1>",
    );
  });

  it("keeps a matching H1 that is not the first block, and leaves a headless note alone", () => {
    const out = html("Intro line.\n\n# Emission Design\n\nBody.", { title: "Emission Design" });
    expect(out).toContain("<h1>Emission Design</h1>");
    expect(html("Just prose.", { title: "Emission Design" })).toContain("Just prose.");
  });

  it("keeps the leading H1 when no title is supplied", () => {
    expect(html("# Emission Design\n\nBody.")).toContain("<h1>Emission Design</h1>");
  });

  it("does not nest an <a> inside an <a> when a link's text is a citable code span", () => {
    // Authored as `[`INDEX.md`](INDEX.md)`: an authored link whose text is
    // itself a doc-path code span the renderer would otherwise auto-link.
    const out = html("[`INDEX.md`](INDEX.md)");
    expect(out).not.toMatch(/<a\b[^>]*>[^<]*<a\b/);
    expect(out).toContain('href="/kb/INDEX"');
  });
});
