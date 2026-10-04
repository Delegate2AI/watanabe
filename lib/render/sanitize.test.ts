import { describe, it, expect } from "vitest";
import { sanitizeDocumentHtml, unwrapDocument } from "./sanitize";

/**
 * Making a model-authored page safe to render and safe to hand to somebody
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The Codex review at checkpoint 2 found the hole this exists to close. The
 * viewer injected its Content-Security-Policy by searching the body text for
 * `<head>`, so a body beginning `<!-- <head> -->` put the policy inside a
 * comment and the page rendered with no policy at all. `sandbox=""` still
 * blocked script and same-origin access, but not a passive `<img>`, so a shared
 * document could beacon its reader's address to whoever wrote it.
 *
 * The fix is not a better search. The wrapper is built here instead, so the
 * policy is unconditionally first in a head we made, and the markup is stripped
 * of script as well, so neither control is carrying the whole weight alone.
 */

describe("unwrapDocument", () => {
  it("takes the outer document tags off and keeps what was inside them", () => {
    const out = unwrapDocument("<!doctype html><html><head><style>h1{}</style></head><body><h1>T</h1></body></html>");
    expect(out).toContain("<style>h1{}</style>");
    expect(out).toContain("<h1>T</h1>");
    expect(out).not.toContain("<!doctype");
    expect(out).not.toMatch(/<html[\s>]/i);
    expect(out).not.toMatch(/<body[\s>]/i);
  });

  it("leaves a fragment that had no wrapper alone", () => {
    expect(unwrapDocument("<h1>T</h1><p>x</p>")).toBe("<h1>T</h1><p>x</p>");
  });

  it("is not fooled by a wrapper tag written with attributes", () => {
    const out = unwrapDocument('<html lang="en"><body class="x"><h1>T</h1></body></html>');
    expect(out).not.toMatch(/<html[\s>]/i);
    expect(out).not.toMatch(/<body[\s>]/i);
    expect(out).toContain("<h1>T</h1>");
  });
});

describe("sanitizeDocumentHtml", () => {
  it("keeps the styling, which is the whole point of a designed page", () => {
    const out = sanitizeDocumentHtml("<style>h1{color:red}</style><h1>T</h1>");
    expect(out).toContain("color:red");
    expect(out).toContain("<h1>T</h1>");
  });

  it("keeps inline svg, which is how a figure is drawn", () => {
    const out = sanitizeDocumentHtml('<svg role="img" aria-label="Orb"><circle r="4"/></svg>');
    expect(out).toContain("<svg");
    expect(out).toContain("<circle");
  });

  it("removes a script block", () => {
    const out = sanitizeDocumentHtml("<h1>T</h1><script>alert(1)</script>");
    expect(out).not.toContain("alert(1)");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("<h1>T</h1>");
  });

  it("removes a script whose tag is cased oddly or carries attributes", () => {
    const out = sanitizeDocumentHtml('<ScRiPt type="module" src="https://x/y.js"></ScRiPt><p>t</p>');
    expect(out).not.toMatch(/script/i);
    expect(out).toContain("<p>t</p>");
  });

  it("removes an inline event handler, which needs no script tag to run", () => {
    const out = sanitizeDocumentHtml('<img src="data:," onerror="alert(1)"><p onclick=\'x()\'>t</p>');
    expect(out).not.toContain("alert(1)");
    expect(out).not.toMatch(/onerror|onclick/i);
  });

  it("removes a handler separated by a slash rather than a space", () => {
    // `<svg/onload=...>` is valid HTML: a solidus is an attribute separator, so
    // a rule that only accepted whitespace before `on` let this straight
    // through. Surfaced by the final Codex pass before it was cut off.
    for (const hostile of ['<svg/onload="alert(1)"></svg>', '<img/onerror="alert(1)">']) {
      const out = sanitizeDocumentHtml(hostile);
      expect(out, hostile).not.toMatch(/onload|onerror/i);
      expect(out, hostile).not.toContain("alert(1)");
    }
  });

  it("removes a handler separated by a tab or a newline", () => {
    expect(sanitizeDocumentHtml('<p\tonclick="alert(1)">t</p>')).not.toMatch(/onclick/i);
    expect(sanitizeDocumentHtml('<p\nonclick="alert(1)">t</p>')).not.toMatch(/onclick/i);
  });

  it("removes a remote reference introduced by a slash separator too", () => {
    const out = sanitizeDocumentHtml('<img/src="https://attacker.example/x.png">');
    expect(out).not.toContain("attacker.example");
  });

  it("does not mistake ordinary words starting with on for a handler", () => {
    const out = sanitizeDocumentHtml('<p class="online">once</p>');
    expect(out).toContain("online");
    expect(out).toContain("once");
  });

  it("removes a remote image, so a shared document cannot report its reader", () => {
    const out = sanitizeDocumentHtml('<img src="https://attacker.example/beacon.png">');
    expect(out).not.toContain("attacker.example");
  });

  it("keeps a data: image, which is how an embedded figure travels", () => {
    const out = sanitizeDocumentHtml('<img src="data:image/png;base64,AAAA" alt="chart">');
    expect(out).toContain("data:image/png;base64,AAAA");
  });

  it("removes a remote stylesheet link", () => {
    const out = sanitizeDocumentHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">');
    expect(out).not.toContain("fonts.googleapis.com");
  });

  it("removes an iframe, which is a network fetch wearing a different tag", () => {
    const out = sanitizeDocumentHtml('<iframe src="https://attacker.example"></iframe><p>t</p>');
    expect(out).not.toMatch(/<iframe/i);
    expect(out).toContain("<p>t</p>");
  });

  it("cannot be talked out of the policy by a comment that looks like a head tag", () => {
    // The exact input from the review. Whatever it does to a text search, the
    // wrapper is built rather than found, so the policy is still first.
    const out = sanitizeDocumentHtml('<!-- <head> --><img src="https://attacker.example/x.png">');
    expect(out).not.toContain("attacker.example");
  });

  it("returns an empty string for an empty body", () => {
    expect(sanitizeDocumentHtml("")).toBe("");
  });

  it("never throws on input that is not really markup", () => {
    expect(() => sanitizeDocumentHtml("<<< &&& not markup")).not.toThrow();
  });
});
