// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { KbTreeAutoScroll } from "./kb-tree-autoscroll";

vi.mock("next/navigation", () => ({ usePathname: () => "/kb/00-overview/glossary" }));

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("KbTreeAutoScroll", () => {
  it("scrolls the container when the active row is below the viewport", () => {
    const container = document.createElement("div");
    container.setAttribute("data-kb-scroll", "");
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    container.scrollTop = 0;
    container.getBoundingClientRect = () => rect(0, 400);

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Knowledge base");
    const active = document.createElement("a");
    active.setAttribute("aria-current", "page");
    active.getBoundingClientRect = () => rect(900, 20); // far below the 0..400 container
    nav.appendChild(active);
    container.appendChild(nav);
    document.body.appendChild(container);

    render(<KbTreeAutoScroll />);
    // 900 - 0 - 200 + 10 = 710
    expect(container.scrollTop).toBe(710);
  });

  it("does not scroll when the active row is already visible", () => {
    const container = document.createElement("div");
    container.setAttribute("data-kb-scroll", "");
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    container.scrollTop = 0;
    container.getBoundingClientRect = () => rect(0, 400);

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Knowledge base");
    const active = document.createElement("a");
    active.setAttribute("aria-current", "page");
    active.getBoundingClientRect = () => rect(120, 20); // within 0..400
    nav.appendChild(active);
    container.appendChild(nav);
    document.body.appendChild(container);

    render(<KbTreeAutoScroll />);
    expect(container.scrollTop).toBe(0);
  });

  it("renders nothing and no-ops when there is no active row", () => {
    const { container } = render(<KbTreeAutoScroll />);
    expect(container).toBeEmptyDOMElement();
  });
});
