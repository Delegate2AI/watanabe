// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VisibilityPicker } from "./visibility-picker";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";

const OPTS: VisibilityOptions = {
  groups: ["all-hands", "board", "exec"],
  people: [{
    email: "alice@example.com",
    groups: ["exec"],
    person: { email: "alice@example.com", name: "Alice Adams", initials: "AA", isSelf: false },
  }],
};

describe("VisibilityPicker", () => {
  it("adds a picked group as a chip and emits the comma-joined value", async () => {
    const onChange = vi.fn();
    render(<VisibilityPicker value="all-hands" onChange={onChange} options={OPTS} />);
    await userEvent.selectOptions(screen.getByLabelText("Add group or person"), "group:exec");
    expect(onChange).toHaveBeenCalledWith("all-hands, exec");
  });

  it("expands a picked person into their groups", async () => {
    const onChange = vi.fn();
    render(<VisibilityPicker value="" onChange={onChange} options={OPTS} />);
    await userEvent.selectOptions(screen.getByLabelText("Add group or person"), "person:alice@example.com");
    expect(onChange).toHaveBeenCalledWith("exec");
  });

  it("removes a chip", async () => {
    const onChange = vi.fn();
    render(<VisibilityPicker value="all-hands, exec" onChange={onChange} options={OPTS} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove exec" }));
    expect(onChange).toHaveBeenCalledWith("all-hands");
  });

  it("does not offer an already-selected group", () => {
    render(<VisibilityPicker value="all-hands, exec" onChange={vi.fn()} options={OPTS} />);
    const select = screen.getByLabelText("Add group or person") as HTMLSelectElement;
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).not.toContain("group:exec");
    expect(values).toContain("group:board");
  });
});

describe("VisibilityPicker person labels", () => {
  it("labels a person by their resolved name while keeping the address as the value", () => {
    render(<VisibilityPicker value="" onChange={vi.fn()} options={OPTS} />);
    const option = screen.getByRole("option", { name: /Alice Adams/ });
    // The value is what gets posted and re-resolved against the roster, so it
    // must stay the address no matter what the label says.
    expect(option).toHaveValue("person:alice@example.com");
  });

  it("labels a person by their bare address when the people flag is off", () => {
    const flagOff: VisibilityOptions = {
      groups: ["all-hands", "exec"],
      people: [{
        email: "alice@example.com",
        groups: ["exec"],
        // What resolvePerson returns with PEOPLE_ENABLED unset.
        person: { email: "alice@example.com", name: "alice@example.com", initials: "A", isSelf: false },
      }],
    };
    render(<VisibilityPicker value="" onChange={vi.fn()} options={flagOff} />);
    expect(screen.getByRole("option", { name: "alice@example.com (exec)" })).toHaveValue(
      "person:alice@example.com",
    );
  });
});
