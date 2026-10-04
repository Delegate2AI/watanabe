// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedDocList } from "./shared-doc-list";

afterEach(cleanup);

describe("SharedDocList", () => {
  it("renders both groups with their empty states", () => {
    const { container } = render(<SharedDocList sharedByMe={[]} sharedWithMe={[]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Shared by me");
    expect(text).toContain("Shared with me");
    expect(text).toContain("not sharing any documents");
    expect(text).toContain("Nothing has been shared with you");
  });

  it("shows owned docs with an Owner pill and a link to the detail view", () => {
    const { container } = render(
      <SharedDocList
        sharedByMe={[{ id: "d1", title: "Launch plan", updatedAt: "2026-07-11T00:00:00.000Z" }]}
        sharedWithMe={[]}
      />,
    );
    expect(container.textContent).toContain("Launch plan");
    expect(container.textContent).toContain("Owner");
    expect(container.querySelector('a[href="/docs/d1"]')).not.toBeNull();
  });

  it("shows shared-with-me docs with the owner and the granted access pill", () => {
    const { container } = render(
      <SharedDocList
        sharedByMe={[]}
        sharedWithMe={[
          { id: "d2", title: "Bob's brief", ownerEmail: "bob@example.com", access: "comment", updatedAt: "2026-07-11T00:00:00.000Z" },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Bob's brief");
    expect(text).toContain("From bob@example.com");
    expect(text).toContain("Can comment");
  });

  it("names the owner through the people directory when one is resolved", () => {
    const { container } = render(
      <SharedDocList
        sharedByMe={[]}
        sharedWithMe={[
          { id: "d2", title: "Bob's brief", ownerEmail: "bob@example.com", access: "view", updatedAt: "2026-07-11T00:00:00.000Z" },
        ]}
        people={{ "bob@example.com": { email: "bob@example.com", name: "Bob Ito", initials: "BI", isSelf: false } }}
      />,
    );
    expect(container.textContent).toContain("From Bob Ito");
  });

  it("narrows both groups from one filter box", async () => {
    render(
      <SharedDocList
        sharedByMe={[{ id: "d1", title: "Launch plan", updatedAt: "2026-07-11T00:00:00.000Z" }]}
        sharedWithMe={[
          { id: "d2", title: "Pricing brief", ownerEmail: "bob@example.com", access: "view", updatedAt: "2026-07-11T00:00:00.000Z" },
        ]}
      />,
    );
    await userEvent.type(screen.getByLabelText("Filter shared docs"), "pricing");
    expect(screen.queryByText("Launch plan")).toBeNull();
    expect(screen.getByText("Pricing brief")).toBeTruthy();
    // The group that now has nothing in it says so, rather than reading as empty.
    expect(screen.getAllByText("No documents match that filter.")).toHaveLength(1);
  });
});
