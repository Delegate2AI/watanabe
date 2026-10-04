// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HtmlDocument } from "./html-document";

/**
 * The isolation boundary for a document the model wrote
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * These assertions are the security property, not styling preferences. The body
 * is authored by a language model and an HTML document can be SHARED, so the
 * person rendering it is frequently not the person whose session produced it.
 * It therefore renders in a frame that cannot run script, cannot reach the
 * portal's origin or its cookies, and cannot make a network request.
 */

const BODY = `<!doctype html><html><head><style>h1{color:red}</style></head>
<body><h1>Quarterly review</h1><p>Body text</p></body></html>`;

function frame(): HTMLIFrameElement {
  return screen.getByTitle("Quarterly review") as HTMLIFrameElement;
}

describe("HtmlDocument", () => {
  it("renders the document inside a frame rather than into the page", () => {
    render(<HtmlDocument html={BODY} title="Quarterly review" />);

    expect(frame().tagName).toBe("IFRAME");
    // The body must NOT have been parsed into the surrounding document: a
    // heading found here would mean the markup escaped the frame.
    expect(screen.queryByRole("heading", { name: "Quarterly review" })).toBeNull();
  });

  it("passes the document by srcdoc, so nothing is fetched to display it", () => {
    render(<HtmlDocument html={BODY} title="Quarterly review" />);

    expect(frame().getAttribute("srcdoc")).toContain("Quarterly review");
    expect(frame().getAttribute("src")).toBeNull();
  });

  it("withholds same-origin access, so the frame cannot reach the portal or its cookies", () => {
    render(<HtmlDocument html={BODY} title="Quarterly review" />);

    const sandbox = frame().getAttribute("sandbox");
    expect(sandbox).not.toBeNull();
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("withholds script execution", () => {
    render(<HtmlDocument html={BODY} title="Quarterly review" />);
    expect(frame().getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("carries a policy that blocks every network request the document could make", () => {
    render(<HtmlDocument html={"<h1>Quarterly review</h1>"} title="Quarterly review" />);

    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("default-src 'none'");
  });

  it("drops a policy the body brought, so it cannot loosen ours", () => {
    const hostile = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src *">
      </head><body><h1>Quarterly review</h1></body></html>`;
    render(<HtmlDocument html={hostile} title="Quarterly review" />);

    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).not.toContain("default-src *");
  });

  it("is not talked out of the policy by a comment shaped like a head tag", () => {
    // The exact bypass the Codex review reproduced: injecting the policy after a
    // `<head>` FOUND by text search put it inside this comment, leaving the page
    // with no policy, and `sandbox=""` does not stop a passive image request. A
    // shared document could beacon its reader's address to whoever wrote it.
    const hostile = '<!-- <head> --><img src="https://attacker.example/beacon.png"><h1>Quarterly review</h1>';
    render(<HtmlDocument html={hostile} title="Quarterly review" />);

    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("attacker.example");
    // The policy is first in a head this component built, not one it located.
    expect(srcdoc.indexOf("default-src 'none'")).toBeLessThan(srcdoc.indexOf("<body>"));
  });

  it("strips script from the body as well, since the same body is also downloaded", () => {
    render(<HtmlDocument html="<script>alert(1)</script><h1>Quarterly review</h1>" title="Quarterly review" />);

    const srcdoc = frame().getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("alert(1)");
  });

  it("names the frame for a screen reader instead of leaving it an unlabelled region", () => {
    render(<HtmlDocument html={BODY} title="Quarterly review" />);
    expect(frame().getAttribute("title")).toBe("Quarterly review");
  });
});
