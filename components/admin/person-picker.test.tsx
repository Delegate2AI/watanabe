// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Person } from "@/lib/people/types";
import { PersonPicker } from "./person-picker";

function person(email: string, name: string, isSelf = false): Person {
  return { email, name, initials: name.charAt(0).toUpperCase(), isSelf };
}

const candidates: Person[] = [
  person("maria.chen@example.com", "Maria Chen"),
  person("tom.baker@example.com", "Tom Baker"),
  person("admin@example.com", "Admin", true),
];

function renderPicker(overrides: { exclude?: string[]; candidates?: Person[] } = {}) {
  const submitted: string[] = [];
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted.push(String(new FormData(event.currentTarget).get("email") ?? ""));
      }}
    >
      <PersonPicker
        candidates={overrides.candidates ?? candidates}
        exclude={overrides.exclude ?? []}
        name="email"
        label="Email to add to research"
      />
      <button>Add</button>
    </form>,
  );
  return { submitted };
}

async function openList() {
  await userEvent.click(screen.getByLabelText("Email to add to research"));
}

describe("PersonPicker", () => {
  it("filters candidates by name", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Email to add to research"), "maria");

    expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
      "Maria Chenmaria.chen@example.com",
    ]);
  });

  it("filters candidates by email", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Email to add to research"), "tom.baker@ex");

    expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
      "Tom Bakertom.baker@example.com",
    ]);
  });

  it("omits people already in the group", async () => {
    renderPicker({ exclude: ["maria.chen@example.com"] });
    await openList();

    const labels = screen.getAllByRole("option").map((row) => row.textContent ?? "");
    expect(labels.some((label) => label.includes("maria.chen@example.com"))).toBe(false);
    expect(labels.some((label) => label.includes("tom.baker@example.com"))).toBe(true);
  });

  it("submits the email of the person clicked, not the label shown", async () => {
    const { submitted } = renderPicker();
    await userEvent.type(screen.getByLabelText("Email to add to research"), "maria");
    await userEvent.click(screen.getByRole("option", { name: /Maria Chen/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(submitted).toEqual(["maria.chen@example.com"]);
  });

  it("commits the highlighted candidate from the keyboard", async () => {
    const { submitted } = renderPicker();
    const field = screen.getByLabelText("Email to add to research");
    await userEvent.type(field, "example.com");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    // Nothing is highlighted while typing: highlight starts at `null`, so the
    // first ArrowDown lands on index 0 (Maria Chen) and the second steps to
    // index 1 (Tom Baker), which Enter then commits.
    expect(submitted).toEqual(["tom.baker@example.com"]);
  });

  it("submits the typed address when Enter is pressed with nothing highlighted", async () => {
    const { submitted } = renderPicker({
      candidates: [person("jsmith@example.com", "J Smith")],
    });
    const field = screen.getByLabelText("Email to add to research");
    await userEvent.type(field, "smith@example.com");
    await userEvent.keyboard("{Enter}");

    // "jsmith@example.com".includes("smith@example.com") is true, so without
    // the null-start highlight rule this Enter would silently commit the
    // wrong, existing candidate instead of the novel typed address.
    expect(submitted).toEqual(["smith@example.com"]);
  });

  it("offers a valid unmatched address as an explicit as-typed row", async () => {
    const { submitted } = renderPicker();
    await userEvent.type(screen.getByLabelText("Email to add to research"), "newhire@example.com");

    const asTyped = screen.getByRole("option", { name: /as typed/ });
    expect(asTyped).toHaveTextContent('Use "newhire@example.com" as typed');

    await userEvent.click(asTyped);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(submitted).toEqual(["newhire@example.com"]);
  });

  it("submits the chosen address as the visible query, not the display label", async () => {
    const { submitted } = renderPicker();
    const field = screen.getByLabelText("Email to add to research");
    await userEvent.type(field, "maria");
    await userEvent.click(screen.getByRole("option", { name: /Maria Chen/ }));

    // The row still shows the name/email pair, but the field itself must show
    // the address once chosen: it is the only thing distinguishing two rows
    // that share a display name, and it is what makes re-filtering work.
    expect(field).toHaveValue("maria.chen@example.com");

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(submitted).toEqual(["maria.chen@example.com"]);
  });

  it("does not carry a highlight over from a previous selection into the next open", async () => {
    // Each email is a substring of the next, so choosing the middle row and
    // reopening still matches all three: the filtered list does not shrink,
    // which is what makes this scenario able to tell a reset apart from a
    // stale index instead of the two coincidentally agreeing.
    const { submitted } = renderPicker({
      candidates: [
        person("abaker@example.com", "Ann Baker"),
        person("baker@example.com", "Bo Baker"),
        person("zbaker@example.com", "Zoe Baker"),
      ],
    });
    const field = screen.getByLabelText("Email to add to research");
    await userEvent.type(field, "baker");
    // Three rows match "baker". ArrowDown twice lands on Bo Baker (index 1),
    // and Enter commits it.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // Reopening must not inherit index 1 from the closed list: the first
    // ArrowDown reopens with nothing highlighted, and the second must start
    // the highlight over at the first row of the freshly filtered list, not
    // step forward from the position left over from the previous selection
    // (which would land on index 2, Zoe Baker, instead).
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options.slice(1).every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);

    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(submitted).toEqual(["abaker@example.com"]);
  });

  it("offers no as-typed row for text that is not an address", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Email to add to research"), "newhire");

    expect(screen.queryByRole("option", { name: /as typed/ })).toBeNull();
  });

  it("submits a fully typed address without touching the list", async () => {
    const { submitted } = renderPicker({ candidates: [] });
    await userEvent.type(screen.getByLabelText("Email to add to research"), "maria.chen@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(submitted).toEqual(["maria.chen@example.com"]);
  });

  it("lists bare addresses when the directory resolved no names", async () => {
    renderPicker({ candidates: [person("maria.chen@example.com", "maria.chen@example.com")] });
    await openList();

    expect(screen.getByRole("option", { name: /maria\.chen@example\.com/ })).toBeInTheDocument();
  });

  it("imports no server module, so the client bundle never reaches the filesystem", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components", "admin", "person-picker.tsx"),
      "utf8",
    );

    expect(source).toContain('"use client"');
    expect(source).not.toContain("lib/people/store");
    expect(source).not.toContain("lib/people/resolve");
  });
});
