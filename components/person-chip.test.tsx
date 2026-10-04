// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Person } from "@/lib/people/types";
import { PersonChip, peopleOptions, personLabel } from "./person-chip";

const maria: Person = {
  email: "maria.chen@example.com",
  name: "Maria Chen",
  initials: "MC",
  isSelf: false,
};
const self: Person = { ...maria, isSelf: true };

describe("PersonChip", () => {
  it("renders the name and keeps the email one hover away", () => {
    render(<PersonChip person={maria} />);

    const chip = screen.getByText("Maria Chen");
    expect(chip).toHaveAttribute("title", "maria.chen@example.com");
  });

  it("renders the initials badge in the avatar variant", () => {
    render(<PersonChip person={maria} variant="avatar" />);

    expect(screen.getByText("MC")).toBeInTheDocument();
    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
  });

  it("renders the viewer as You in the inline and avatar variants", () => {
    const { rerender } = render(<PersonChip person={self} />);
    expect(screen.getByText("You")).toBeInTheDocument();

    rerender(<PersonChip person={self} variant="avatar" />);
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("renders a bare string for the option variant so a select label stays plain", () => {
    const { container } = render(
      <select defaultValue={maria.email}>
        <option value={maria.email}>
          <PersonChip person={maria} variant="option" />
        </option>
      </select>,
    );

    expect(container.querySelector("option")?.textContent).toBe("Maria Chen");
  });

  it("keeps a self option unambiguous by naming the address", () => {
    expect(personLabel(self, "option")).toBe("You (maria.chen@example.com)");
    expect(personLabel(self, "inline")).toBe("You");
    expect(personLabel(maria, "option")).toBe("Maria Chen");
  });

  it("spells out the viewer's own name in the named variant", () => {
    expect(personLabel(self, "named")).toBe("You (Maria Chen)");
    expect(personLabel(maria, "named")).toBe("Maria Chen");

    render(<PersonChip person={self} variant="named" />);
    expect(screen.getByText("You (Maria Chen)")).toBeInTheDocument();
  });

  it("renders the raw email a flag-off resolve hands it, with no You substitution", () => {
    const flagOff: Person = {
      email: "maria.chen@example.com",
      name: "maria.chen@example.com",
      initials: "M",
      isSelf: false,
    };
    render(<PersonChip person={flagOff} />);

    expect(screen.getByText("maria.chen@example.com")).toBeInTheDocument();
  });

  it("imports no server module, so the client bundle never reaches the filesystem", () => {
    const source = readFileSync(path.join(process.cwd(), "components", "person-chip.tsx"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));

    expect(source).toContain('"use client"');
    // person-view.ts is the pure sibling that holds the lookup/label helpers (no
    // "use client", so a server component can call them); it imports only the
    // Person type, so pulling it in here keeps the client bundle fs-free.
    expect(imports).toEqual([
      'import type { ReactNode } from "react";',
      'import type { Person } from "@/lib/people/types";',
      'import { type PersonChipVariant, personLabel } from "@/components/person-view";',
    ]);
  });

  it("builds a deduped, sorted candidate list and falls back to the address", () => {
    const people: Record<string, Person> = {
      "maria.chen@example.com": maria,
      "admin@example.com": { ...maria, email: "admin@example.com", name: "Admin", isSelf: true },
    };

    const options = peopleOptions(
      ["MARIA.CHEN@example.com", " maria.chen@example.com ", "admin@example.com", "nobody@example.com"],
      people,
    );

    expect(options.map((person) => person.email)).toEqual([
      "admin@example.com",
      "maria.chen@example.com",
      "nobody@example.com",
    ]);
    // Unknown to the directory: the address is the label, never a blank row.
    expect(options[2].name).toBe("nobody@example.com");
    // The viewer sorts under "You (...)", and keeps their address visible.
    expect(personLabel(options[0], "option")).toBe("You (admin@example.com)");

    // The viewer is sorted by their name like anyone else, not pinned to the front.
    const lateViewer: Person = { ...maria, email: "zoe@example.com", name: "Zoe Adams", isSelf: true };
    const lateViewerPeople: Record<string, Person> = {
      "maria.chen@example.com": maria,
      "zoe@example.com": lateViewer,
    };
    const lateViewerOptions = peopleOptions(["maria.chen@example.com", "zoe@example.com"], lateViewerPeople);
    expect(lateViewerOptions.map((person) => person.email)).toEqual([
      "maria.chen@example.com",
      "zoe@example.com",
    ]);
    expect(lateViewerOptions[1]).toBe(lateViewer);
  });
});
