// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AccessState } from "@/lib/authority/access";
import type { Person } from "@/lib/people/types";
import { AccessMembers } from "./access-members";

const access: AccessState = {
  groups: { exec: ["maria.chen@example.com"] },
  roles: { editor: ["maria.chen@example.com"] },
  flags: {},
  default: "viewer",
};
const roster = ["maria.chen@example.com"];

function renderMembers(overrides: {
  people?: Record<string, Person>;
  peopleEnabled?: boolean;
  candidates?: Person[];
  aliases?: Record<string, string[]>;
  aliasesEnabled?: boolean;
  renamePerson?: (email: string, name: string) => Promise<boolean>;
  mutate?: (change: unknown) => Promise<boolean>;
  mutateAlias?: (verb: "addAlias" | "removeAlias", email: string, alias: string) => Promise<boolean>;
  onNotice?: (message: string) => void;
} = {}) {
  const renamePerson = overrides.renamePerson ?? vi.fn().mockResolvedValue(true);
  const mutate = overrides.mutate ?? vi.fn().mockResolvedValue(true);
  const mutateAlias = overrides.mutateAlias ?? vi.fn().mockResolvedValue(true);
  const onNotice = overrides.onNotice ?? vi.fn();
  const view = render(
    <AccessMembers
      access={access}
      people={overrides.people ?? {}}
      roster={roster}
      candidates={overrides.candidates ?? []}
      aliases={overrides.aliases ?? {}}
      peopleEnabled={overrides.peopleEnabled ?? false}
      groupsEnabled
      rolesEnabled
      aliasesEnabled={overrides.aliasesEnabled ?? false}
      pending={false}
      mutate={mutate}
      renamePerson={renamePerson}
      mutateAlias={mutateAlias}
      onNotice={onNotice}
    />,
  );
  return { ...view, renamePerson, mutate, mutateAlias, onNotice };
}

/** What a flag-off resolvePerson() hands the page. */
const flagOff: Record<string, Person> = {
  "maria.chen@example.com": {
    email: "maria.chen@example.com",
    name: "maria.chen@example.com",
    initials: "M",
    isSelf: false,
  },
};

/** What a flag-on resolvePerson() hands the page. */
const flagOn: Record<string, Person> = {
  "maria.chen@example.com": {
    email: "maria.chen@example.com",
    name: "Maria Chen",
    initials: "MC",
    isSelf: false,
  },
};

describe("AccessMembers", () => {
  it("renders the bare email and offers no name edit when the flag is off", () => {
    renderMembers({ people: flagOff });

    expect(screen.getByText("maria.chen@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit name" })).toBeNull();
  });

  it("falls back to the address when the server resolved nobody", () => {
    renderMembers();

    expect(screen.getByText("maria.chen@example.com")).toBeInTheDocument();
  });

  it("renders the resolved name with the address one hover away", () => {
    renderMembers({ people: flagOn, peopleEnabled: true });

    expect(screen.getByText("Maria Chen")).toHaveAttribute("title", "maria.chen@example.com");
    expect(screen.getByRole("button", { name: "Edit name" })).toBeInTheDocument();
  });

  it("prints the address on the row, since that is what every control here edits", () => {
    // Several rows can share a display name (one person under two addresses, or
    // two colleagues with the same first name). A hover title cannot tell them
    // apart on the page whose whole job is editing those identities.
    const { container } = renderMembers({ people: flagOn, peopleEnabled: true });

    expect(container.textContent).toContain("maria.chen@example.com");
  });

  it("does not print the address twice when the name IS the address", () => {
    // People directory off, or nobody has named this person yet: the chip
    // already renders the address, so a second line would repeat it.
    const { container } = renderMembers({ people: flagOff });

    expect(container.textContent?.match(/maria\.chen@example\.com/g) ?? []).toHaveLength(1);
  });

  it("submits an edited name and closes the editor", async () => {
    const renamePerson = vi.fn().mockResolvedValue(true);
    renderMembers({ people: flagOn, peopleEnabled: true, renamePerson });

    await userEvent.click(screen.getByRole("button", { name: "Edit name" }));
    const field = screen.getByLabelText("Name for maria.chen@example.com");
    expect(field).toHaveValue("Maria Chen");
    await userEvent.clear(field);
    await userEvent.type(field, "Maria C. Chen");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(renamePerson).toHaveBeenCalledWith("maria.chen@example.com", "Maria C. Chen");
    expect(screen.queryByLabelText("Name for maria.chen@example.com")).toBeNull();
  });

  it("keeps the editor open when the write is refused", async () => {
    const renamePerson = vi.fn().mockResolvedValue(false);
    renderMembers({ people: flagOn, peopleEnabled: true, renamePerson });

    await userEvent.click(screen.getByRole("button", { name: "Edit name" }));
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(screen.getByLabelText("Name for maria.chen@example.com")).toBeInTheDocument();
  });

  it("keeps the email as the role select's identity, not the name", () => {
    renderMembers({ people: flagOn, peopleEnabled: true });

    expect(screen.getByLabelText("Role for maria.chen@example.com")).toHaveValue("editor");
  });

  it("names the admin's own row instead of collapsing it to You", () => {
    const self: Record<string, Person> = {
      "maria.chen@example.com": { ...flagOn["maria.chen@example.com"], isSelf: true },
    };
    renderMembers({ people: self, peopleEnabled: true });

    expect(screen.getByText("You (Maria Chen)")).toBeInTheDocument();
  });

  it("offers known people in the add-member picker", async () => {
    renderMembers({
      candidates: [
        { email: "tom.baker@example.com", name: "Tom Baker", initials: "TB", isSelf: false },
      ],
    });

    await userEvent.click(screen.getByLabelText("Member email"));

    expect(screen.getByRole("option", { name: /Tom Baker/ })).toBeInTheDocument();
  });

  it("reports and does not submit when Add is clicked with no address resolved", async () => {
    const { mutate, onNotice } = renderMembers({
      candidates: [
        { email: "tom.baker@example.com", name: "Tom Baker", initials: "TB", isSelf: false },
      ],
    });

    // Highlighting a row with the mouse is not choosing it: only a click or
    // Enter on the highlighted row commits. A partial, incomplete query like
    // "tom" resolves to no address at all.
    await userEvent.type(screen.getByLabelText("Member email"), "tom");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    expect(onNotice).toHaveBeenCalledWith(
      "Choose a person from the list, or type a full email address.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("offers no alias control at all with the flag off", () => {
    renderMembers({ aliases: { "maria.chen@example.com": ["maria.personal@example.test"] } });

    expect(screen.queryByRole("button", { name: /Aliases/ })).toBeNull();
  });

  it("counts a person's aliases on the toggle and opens their panel", async () => {
    renderMembers({
      aliasesEnabled: true,
      aliases: { "maria.chen@example.com": ["maria.personal@example.test"] },
    });

    const toggle = screen.getByRole("button", { name: "Aliases (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);

    expect(screen.getByText("maria.personal@example.test")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the panel again on a second click", async () => {
    renderMembers({ aliasesEnabled: true, aliases: { "maria.chen@example.com": ["maria.personal@example.test"] } });

    await userEvent.click(screen.getByRole("button", { name: "Aliases (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Aliases (1)" }));

    expect(screen.queryByText("maria.personal@example.test")).toBeNull();
  });

  it("shows a zero count for a person with no aliases yet", () => {
    renderMembers({ aliasesEnabled: true });

    expect(screen.getByRole("button", { name: "Aliases (0)" })).toBeInTheDocument();
  });

  it("hands the panel's removal straight to the mutation", async () => {
    const { mutateAlias } = renderMembers({
      aliasesEnabled: true,
      aliases: { "maria.chen@example.com": ["maria.personal@example.test"] },
    });

    await userEvent.click(screen.getByRole("button", { name: "Aliases (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(mutateAlias).toHaveBeenCalledWith(
      "removeAlias",
      "maria.chen@example.com",
      "maria.personal@example.test",
    );
  });
});
