import { describe, it, expect } from "vitest";
import { rewriteWikilinks, type WikilinkResolver } from "./wikilinks";
import type { KbAssetResolver } from "./assets";

/** A resolver that only knows two notes in the projection. */
const resolver: WikilinkResolver = (target) => {
  const known: Record<string, string> = {
    "Product Vision": "00-overview/product-vision",
    "00-overview/product-vision": "00-overview/product-vision",
    Roadmap: "01-planning/roadmap",
  };
  return known[target] ?? null;
};

/** An asset index disjoint from the note one, as the real pair is (no `.md`). */
const assetResolver: KbAssetResolver = (src) => {
  const known: Record<string, string> = {
    "Diagram.png": "assets/Diagram.png",
    "My Diagram.png": "assets/My Diagram.png",
    "img.png": "img.png",
  };
  return src ? (known[src] ?? null) : null;
};

describe("rewriteWikilinks", () => {
  it("rewrites a title wikilink to a /kb route link", () => {
    const out = rewriteWikilinks("See [[Product Vision]].", { resolve: resolver });
    expect(out).toBe("See [Product Vision](/kb/00-overview/product-vision).");
  });

  it("rewrites a path wikilink", () => {
    const out = rewriteWikilinks("[[00-overview/product-vision]]", { resolve: resolver });
    expect(out).toBe("[00-overview/product-vision](/kb/00-overview/product-vision)");
  });

  it("uses the alias as the link label", () => {
    const out = rewriteWikilinks("[[Roadmap|the plan]]", { resolve: resolver });
    expect(out).toBe("[the plan](/kb/01-planning/roadmap)");
  });

  it("carries a heading anchor", () => {
    const out = rewriteWikilinks("[[Roadmap#Q3 Goals]]", { resolve: resolver });
    expect(out).toBe("[Roadmap](/kb/01-planning/roadmap#q3-goals)");
  });

  it("renders a link to an absent note as inert text, not a link", () => {
    const out = rewriteWikilinks("secret is [[Exec Comp Plan]] here", { resolve: resolver });
    // No markdown link syntax, no route: the label survives as plain text only.
    expect(out).toBe("secret is Exec Comp Plan here");
    expect(out).not.toContain("(/kb/");
    expect(out).not.toContain("[[");
  });

  it("renders an absent note's alias as inert text", () => {
    const out = rewriteWikilinks("[[secret/path|Codename]]", { resolve: resolver });
    expect(out).toBe("Codename");
  });
});

/**
 * `![[...]]` is an embed, and the `!` is part of the syntax. Before this, the
 * match started at `[[`, so the `!` survived onto the output: a note embed
 * became `![note](/kb/note)` (an `<img>` pointing at an HTML route, i.e. a
 * broken image) and an asset embed printed the literal text `!Diagram.png`.
 * These are the regression net for that.
 */
describe("rewriteWikilinks embeds", () => {
  const options = { resolve: resolver, resolveAsset: assetResolver };

  it("inlines an asset embed as an image pointing at the byte route", () => {
    expect(rewriteWikilinks("![[Diagram.png]]", options)).toBe(
      "![Diagram.png](/api/kb/asset/assets/Diagram.png)",
    );
  });

  it("degrades a note embed to an ordinary wikilink instead of transcluding it", () => {
    expect(rewriteWikilinks("![[Product Vision]]", options)).toBe(
      "[Product Vision](/kb/00-overview/product-vision)",
    );
  });

  it("renders an embed of an absent target as inert text, without the leading !", () => {
    const out = rewriteWikilinks("see ![[nothing]] here", options);
    expect(out).toBe("see nothing here");
    expect(out).not.toContain("!");
    expect(out).not.toContain("[[");
  });

  it("discards the display-size hint, which is not an alias in an embed", () => {
    expect(rewriteWikilinks("![[img.png|300]]", options)).toBe("![img.png](/api/kb/asset/img.png)");
    expect(rewriteWikilinks("![[img.png|300x200]]", options)).toBe(
      "![img.png](/api/kb/asset/img.png)",
    );
  });

  it("percent-encodes a target containing spaces so the destination cannot truncate", () => {
    const out = rewriteWikilinks("![[My Diagram.png]]", options);
    expect(out).toBe("![My Diagram.png](/api/kb/asset/assets/My%20Diagram.png)");
    // The space survives in the alt text only; a raw space in the destination
    // would end the link at "My".
    expect(out).not.toContain("asset/assets/My Diagram");
  });

  it("degrades an embed with a heading fragment to an anchored link, not a transclusion", () => {
    expect(rewriteWikilinks("![[Roadmap#Q3 Goals]]", options)).toBe(
      "[Roadmap](/kb/01-planning/roadmap#q3-goals)",
    );
  });

  it("resolves a note before an asset, and needs no asset resolver to do it", () => {
    expect(rewriteWikilinks("![[Roadmap]]", { resolve: resolver })).toBe(
      "[Roadmap](/kb/01-planning/roadmap)",
    );
    // With no resolver supplied, an asset embed has nothing to resolve against
    // and falls to inert text rather than emitting a broken image.
    expect(rewriteWikilinks("![[Diagram.png]]", { resolve: resolver })).toBe("Diagram.png");
  });

  it("scopes the asset lookup to the current note's directory", () => {
    const seen: string[][] = [];
    rewriteWikilinks("![[Diagram.png]]", {
      resolve: resolver,
      resolveAsset: (src, currentDirSlug) => {
        seen.push(currentDirSlug);
        return assetResolver(src, currentDirSlug);
      },
      currentRelPath: "00-overview/deep/note.md",
    });
    expect(seen).toEqual([["00-overview", "deep"]]);
  });

  it("leaves every non-embed wikilink byte-identical", () => {
    const body = [
      "See [[Product Vision]].",
      "[[00-overview/product-vision]]",
      "[[Roadmap|the plan]]",
      "[[Roadmap#Q3 Goals]]",
      "secret is [[Exec Comp Plan]] here",
    ].join("\n");
    expect(rewriteWikilinks(body, options)).toBe(rewriteWikilinks(body, { resolve: resolver }));
    expect(rewriteWikilinks(body, options)).toBe(
      [
        "See [Product Vision](/kb/00-overview/product-vision).",
        "[00-overview/product-vision](/kb/00-overview/product-vision)",
        "[the plan](/kb/01-planning/roadmap)",
        "[Roadmap](/kb/01-planning/roadmap#q3-goals)",
        "secret is Exec Comp Plan here",
      ].join("\n"),
    );
  });
});
