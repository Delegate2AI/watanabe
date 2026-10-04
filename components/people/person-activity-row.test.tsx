// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonActivityRow } from "./person-activity-row";
import { personSlug } from "@/lib/people/slug";
import type { PersonActivity } from "@/lib/people/activity";

/**
 * Plain object literals rather than a factory import: `lib/people/activity.ts`
 * is imported for its types only, so these tests do not depend on its runtime.
 */
function makeActivity(over: {
  email?: string;
  name?: string;
  tasks?: Partial<PersonActivity["tasks"]>;
  meetings?: Partial<PersonActivity["meetings"]>;
  lastActivityAt?: string | null;
} = {}): PersonActivity {
  return {
    person: {
      email: over.email ?? "maria.chen@example.com",
      name: over.name ?? "Maria Chen",
      initials: "MC",
      isSelf: false,
    },
    tasks: { open: 0, overdue: 0, proposed: 0, completed: 0, ...over.tasks },
    meetings: { inWindow: 0, latest: null, ...over.meetings },
    lastActivityAt: over.lastActivityAt ?? null,
  };
}

function statFor(container: HTMLElement, stat: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-stat="${stat}"]`);
  if (!el) throw new Error(`no [data-stat="${stat}"] in the row`);
  return el;
}

describe("PersonActivityRow", () => {
  it("renders the person and every count", () => {
    const { container } = render(
      <PersonActivityRow
        activity={makeActivity({
          tasks: { open: 4, overdue: 2, proposed: 1, completed: 5 },
          meetings: { inWindow: 7 },
        })}
      />,
    );
    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
    expect(statFor(container, "open").textContent).toBe("4");
    expect(statFor(container, "completed").textContent).toBe("5");
    expect(statFor(container, "overdue").textContent).toBe("2");
    expect(statFor(container, "proposed").textContent).toBe("1");
    expect(statFor(container, "meetings").textContent).toBe("7");
  });

  // Completed sits next to Open, before Overdue: the two columns a reader
  // compares are adjacent.
  it("puts Completed immediately after Open", () => {
    const { container } = render(<PersonActivityRow activity={makeActivity()} />);
    const order = Array.from(container.querySelectorAll("[data-stat]")).map((el) =>
      el.getAttribute("data-stat"),
    );
    expect(order).toEqual(["open", "completed", "overdue", "proposed", "meetings", "last-activity"]);
  });

  // The row used to link to `/people/<url-encoded address>`, which put a
  // colleague's email into browser history, referrers and access logs.
  it("links the whole row by an opaque key that does not carry the address", () => {
    render(<PersonActivityRow activity={makeActivity({ email: "ken+kb@example.com" })} />);
    const href = screen.getByRole("link").getAttribute("href")!;

    expect(href).toBe(`/people/${personSlug("ken+kb@example.com")}`);
    expect(href).not.toContain("ken");
    expect(href).not.toContain("example.com");
    expect(href).not.toContain("%40");
  });

  it("derives the same key regardless of case or surrounding space", () => {
    expect(personSlug(" Ken+KB@Example.com ")).toBe(personSlug("ken+kb@example.com"));
  });

  it("renders a non-zero overdue count in the warn tone", () => {
    const { container } = render(
      <PersonActivityRow activity={makeActivity({ tasks: { overdue: 3 } })} />,
    );
    expect(statFor(container, "overdue")).toHaveClass("text-warn");
  });

  it("renders a zero overdue count in the same muted tone as every other zero", () => {
    const { container } = render(<PersonActivityRow activity={makeActivity()} />);
    const overdue = statFor(container, "overdue");
    // The point of the rule: at rest the page must not look alarming.
    expect(overdue).not.toHaveClass("text-warn");
    expect(overdue.className).toBe(statFor(container, "open").className);
  });

  it("keeps the warn tone off the other counts even when they are high", () => {
    const { container } = render(
      <PersonActivityRow
        activity={makeActivity({ tasks: { open: 12, proposed: 9 }, meetings: { inWindow: 20 } })}
      />,
    );
    for (const stat of ["open", "proposed", "meetings"]) {
      expect(statFor(container, stat)).not.toHaveClass("text-warn");
    }
  });

  it("reads non-zero counts as normal ink and zero counts as faint", () => {
    const { container } = render(
      <PersonActivityRow activity={makeActivity({ tasks: { open: 5 } })} />,
    );
    expect(statFor(container, "open")).toHaveClass("text-ink");
    expect(statFor(container, "proposed")).toHaveClass("text-ink-faint");
  });

  it("renders last activity as a time element with the exact day one hover away", () => {
    const { container } = render(
      <PersonActivityRow activity={makeActivity({ lastActivityAt: "2026-07-01" })} />,
    );
    const stamp = statFor(container, "last-activity");
    expect(stamp.tagName).toBe("TIME");
    expect(stamp).toHaveAttribute("datetime", "2026-07-01");
    expect(stamp).toHaveAttribute("title", "1 Jul 2026");
  });

  it("says so plainly when a person has no activity at all", () => {
    const { container } = render(<PersonActivityRow activity={makeActivity()} />);
    const stamp = statFor(container, "last-activity");
    expect(stamp.textContent).toBe("No activity");
    expect(stamp).toHaveClass("text-ink-faint");
  });
});
