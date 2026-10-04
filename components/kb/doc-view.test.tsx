// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocView } from "./doc-view";
import type { Note } from "@/lib/kb/note";

// Rendering only. The toolbar actions (chat, copy link, propose an edit) and
// their fetch/clipboard/router plumbing live in ./doc-view.actions.test.tsx.
const isPeopleEnabledMock = vi.fn(() => false);
vi.mock("@/lib/people/config", () => ({ isPeopleEnabled: () => isPeopleEnabledMock() }));
const resolvePersonMock = vi.fn();
vi.mock("@/lib/people/resolve", () => ({ resolvePerson: (...a: unknown[]) => resolvePersonMock(...a) }));

const note: Note = {
  title: "Exec Comp Plan",
  type: "canon",
  updated: "2026-07-01",
  owner: "nick@example.com",
  visibility: "restricted",
  group: "Exec",
  body: "# Exec Comp Plan\n\nSee [[Roadmap]] and [external](https://example.com).",
};

beforeEach(() => {
  resolvePersonMock.mockReset();
});

describe("DocView", () => {
  it("renders the frontmatter header (title, meta, visibility chip)", () => {
    render(
      <DocView
        note={{ ...note, body: "Plain body, no heading." }}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Exec Comp Plan" })).toBeInTheDocument();
    expect(screen.getByText(/canon/)).toBeInTheDocument();
    expect(screen.getByText(/Updated 1 Jul 2026/)).toBeInTheDocument();
    expect(screen.getByText("Exec")).toBeInTheDocument(); // restricted chip label
  });

  it("renders the title once, dropping the body's own repeat of it", () => {
    render(
      <DocView
        note={{ ...note, body: "# Exec Comp Plan\n\nBand detail." }}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1, name: "Exec Comp Plan" })).toHaveLength(1);
    expect(screen.getByText("Band detail.")).toBeInTheDocument();
  });

  it("renders the sanitized body and resolves a known wikilink", () => {
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={(t) => (t === "Roadmap" ? "01-planning/roadmap" : null)}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    const roadmap = screen.getByRole("link", { name: "Roadmap" });
    expect(roadmap).toHaveAttribute("href", "/kb/01-planning/roadmap");
    const external = screen.getByRole("link", { name: "external" });
    expect(external).toHaveAttribute("href", "https://example.com");
  });

  it("points an embedded image at the resolved asset's byte route", () => {
    render(
      <DocView
        note={{ ...note, body: "![Diagram](Diagram.png)" }}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={(src) => (src === "Diagram.png" ? "assets/charts/Diagram.png" : null)}
        backlinks={[]}
      />,
    );
    const img = screen.getByRole("img", { name: "Diagram" });
    expect(img).toHaveAttribute("src", "/api/kb/asset/assets/charts/Diagram.png");
  });

  it("renders an absent wikilink target as inert text, not a link", () => {
    render(
      <DocView
        note={{ ...note, body: "Secret is [[Board Deck]] here." }}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.queryByRole("link", { name: /board deck/i })).toBeNull();
    expect(screen.getByText(/Board Deck/)).toBeInTheDocument();
  });

});

describe("DocView byline", () => {
  it("renders the owner address verbatim when the people flag is off", () => {
    isPeopleEnabledMock.mockReturnValue(false);
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.getByText(/nick@example\.com/)).toBeInTheDocument();
    expect(resolvePersonMock).not.toHaveBeenCalled();
  });

  it("renders the resolved name when the people flag is on", () => {
    isPeopleEnabledMock.mockReturnValue(true);
    resolvePersonMock.mockReturnValue({
      email: "nick@example.com",
      name: "Taylor Reed",
      initials: "TR",
      isSelf: false,
    });
    render(
      <DocView
        note={note}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.getByText("Taylor Reed")).toBeInTheDocument();
  });

  it("leaves an owner that is not an address alone, flag on or off", () => {
    isPeopleEnabledMock.mockReturnValue(true);
    render(
      <DocView
        note={{ ...note, owner: "Finance Team" }}
        relPath="exec/comp.md"
        dirSlug={["exec"]}
        resolveWikilink={() => null}
        resolveAsset={() => null}
        backlinks={[]}
      />,
    );
    expect(screen.getByText(/Finance Team/)).toBeInTheDocument();
  });
});
