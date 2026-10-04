// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AssigneeChip, MemberOptions } from "./assignee";
import type { Person } from "@/lib/people/types";

afterEach(cleanup);

/**
 * Exactly what `resolvePerson` returns with `PEOPLE_ENABLED` unset. Every
 * flag-off assertion below compares against this, which is what makes them a
 * check on byte-identity with the pre-directory rendering rather than a
 * restatement of the current code.
 */
function flagOff(email: string): Person {
  return { email, name: email, initials: email.charAt(0).toUpperCase(), isSelf: false };
}

const FLAG_OFF = { "maria.chen@example.com": flagOff("maria.chen@example.com") };
const RESOLVED: Record<string, Person> = {
  "maria.chen@example.com": {
    email: "maria.chen@example.com",
    name: "Maria Chen",
    initials: "MC",
    isSelf: false,
  },
  "me@example.com": { email: "me@example.com", name: "Me", initials: "M", isSelf: true },
};

describe("AssigneeChip", () => {
  it("renders the bare address when the people flag is off", () => {
    render(<AssigneeChip email="maria.chen@example.com" people={FLAG_OFF} />);
    expect(screen.getByText("maria.chen@example.com")).toBeInTheDocument();
  });

  it("renders the resolved name when the directory has one", () => {
    render(<AssigneeChip email="maria.chen@example.com" people={RESOLVED} />);
    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
  });

  it("takes the avatar letters from the chip, so Maria Chen is MC and not MA", () => {
    render(<AssigneeChip email="maria.chen@example.com" people={RESOLVED} />);
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("keeps the address reachable on hover, so a name is never the only handle", () => {
    render(<AssigneeChip email="maria.chen@example.com" people={RESOLVED} />);
    expect(screen.getByTitle("maria.chen@example.com")).toBeInTheDocument();
  });

  it("says needs triage rather than rendering an empty chip", () => {
    render(<AssigneeChip email={null} people={RESOLVED} />);
    expect(screen.getByText("Needs triage")).toBeInTheDocument();
  });

  it("falls back to the address for someone the server did not resolve", () => {
    render(<AssigneeChip email="stranger@example.com" people={RESOLVED} />);
    expect(screen.getByText("stranger@example.com")).toBeInTheDocument();
  });
});

describe("MemberOptions", () => {
  function options(people: Record<string, Person>) {
    render(
      <select aria-label="Assignee" defaultValue="">
        <option value="">Unassigned</option>
        <MemberOptions members={["maria.chen@example.com", "me@example.com"]} people={people} />
      </select>,
    );
    return Array.from(screen.getByLabelText("Assignee").querySelectorAll("option"));
  }

  it("posts the address, never the name: the API validates against the roster", () => {
    expect(options(RESOLVED).map((o) => o.value)).toEqual([
      "",
      "maria.chen@example.com",
      "me@example.com",
    ]);
  });

  it("labels each option with the resolved name", () => {
    expect(options(RESOLVED)[1].textContent).toBe("Maria Chen");
  });

  it("keeps the address on the viewer's own option, so the choice is unambiguous", () => {
    expect(options(RESOLVED)[2].textContent).toBe("You (me@example.com)");
  });

  it("labels every option with the bare address when the people flag is off", () => {
    const labels = options({
      ...FLAG_OFF,
      "me@example.com": flagOff("me@example.com"),
    }).map((o) => o.textContent);
    expect(labels).toEqual(["Unassigned", "maria.chen@example.com", "me@example.com"]);
  });

  it("carries the address on every option of a name two colleagues share", () => {
    const namesakes: Record<string, Person> = {
      "nick.a@example.com": { email: "nick.a@example.com", name: "Nick", initials: "N", isSelf: false },
      "nick.b@example.com": { email: "nick.b@example.com", name: "Nick", initials: "N", isSelf: false },
      "maria.chen@example.com": RESOLVED["maria.chen@example.com"],
    };
    render(
      <select aria-label="Reassign" defaultValue="">
        <MemberOptions
          members={["nick.a@example.com", "nick.b@example.com", "maria.chen@example.com"]}
          people={namesakes}
        />
      </select>,
    );

    const labels = Array.from(screen.getByLabelText("Reassign").querySelectorAll("option"))
      .map((o) => o.textContent);
    expect(labels).toEqual([
      "Nick (nick.a@example.com)",
      "Nick (nick.b@example.com)",
      // Untouched: a name that is unique in the list still renders bare.
      "Maria Chen",
    ]);
  });
});
