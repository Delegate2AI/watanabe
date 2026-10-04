// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SearchResult } from "./search-result";
import type { KbSearchRow } from "@/lib/kb/search";

const base: KbSearchRow = {
  route: "00-overview/vision",
  relPath: "00-overview/vision.md",
  title: "Product Vision",
  visibility: "all-hands",
  snippet: "the north star metric is retention",
  matchStart: 4,
  matchEnd: 14,
};

describe("SearchResult", () => {
  it("links to the note and shows title, path, and snippet", () => {
    render(
      <ul>
        <SearchResult row={base} />
      </ul>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/kb/00-overview/vision");
    expect(screen.getByText("Product Vision")).toBeInTheDocument();
    expect(screen.getByText("00-overview/vision.md")).toBeInTheDocument();
    expect(screen.getByText(/north star/)).toBeInTheDocument();
  });

  it("marks the matched term inside the snippet", () => {
    const { container } = render(
      <ul>
        <SearchResult row={base} />
      </ul>,
    );
    expect(container.querySelector("mark")?.textContent).toBe("north star");
  });

  it("renders the snippet plainly when there are no match offsets", () => {
    const { container } = render(
      <ul>
        <SearchResult row={{ ...base, matchStart: 0, matchEnd: 0 }} />
      </ul>,
    );
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText(/north star/)).toBeInTheDocument();
  });

  it("shows a restricted chip only for a restricted row", () => {
    render(
      <ul>
        <SearchResult row={{ ...base, visibility: "restricted", group: "Exec" }} />
      </ul>,
    );
    expect(screen.getByText("Exec")).toBeInTheDocument();
  });
});
