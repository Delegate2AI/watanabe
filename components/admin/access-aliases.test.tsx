// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessAliases } from "./access-aliases";

const EMAIL = "maria.chen@example.com";
const ALIAS = "maria.personal@example.test";

function renderPanel(overrides: {
  aliases?: string[];
  groups?: string[];
  pending?: boolean;
  mutateAlias?: (verb: "addAlias" | "removeAlias", email: string, alias: string) => Promise<boolean>;
  onNotice?: (message: string) => void;
} = {}) {
  const mutateAlias = overrides.mutateAlias ?? vi.fn().mockResolvedValue(true);
  const onNotice = overrides.onNotice ?? vi.fn();
  render(
    <AccessAliases
      email={EMAIL}
      name="Maria Chen"
      aliases={overrides.aliases ?? []}
      groups={overrides.groups ?? ["all-hands", "exec"]}
      pending={overrides.pending ?? false}
      mutateAlias={mutateAlias}
      onNotice={onNotice}
    />,
  );
  return { mutateAlias, onNotice };
}

describe("AccessAliases", () => {
  it("lists the addresses that resolve to this person", () => {
    renderPanel({ aliases: [ALIAS, "m.chen@old-co.test"] });

    expect(screen.getByText(ALIAS)).toBeInTheDocument();
    expect(screen.getByText("m.chen@old-co.test")).toBeInTheDocument();
  });

  it("says so plainly when there are none", () => {
    renderPanel();

    expect(screen.getByText(`No other addresses resolve to ${EMAIL}.`)).toBeInTheDocument();
  });

  it("names the clearance being handed over before it commits anything", async () => {
    const user = userEvent.setup();
    const { mutateAlias } = renderPanel();

    await user.type(screen.getByLabelText(`Add an alias for ${EMAIL}`), ALIAS);
    await user.click(screen.getByRole("button", { name: "Add alias" }));

    expect(mutateAlias).not.toHaveBeenCalled();
    expect(screen.getByText(/will have Maria Chen's role, and their clearance/)).toBeInTheDocument();
    expect(screen.getByText("all-hands, exec")).toBeInTheDocument();
  });

  it("commits the alias once confirmed", async () => {
    const user = userEvent.setup();
    const { mutateAlias } = renderPanel();

    await user.type(screen.getByLabelText(`Add an alias for ${EMAIL}`), ALIAS);
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Add alias" }));

    expect(mutateAlias).toHaveBeenCalledWith("addAlias", EMAIL, ALIAS);
  });

  it("normalizes the typed address before confirming it", async () => {
    const user = userEvent.setup();
    const { mutateAlias } = renderPanel();

    await user.type(screen.getByLabelText(`Add an alias for ${EMAIL}`), `  MARIA.Personal@Example.test  `);
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Add alias" }));

    expect(mutateAlias).toHaveBeenCalledWith("addAlias", EMAIL, ALIAS);
  });

  it("abandons the add on cancel", async () => {
    const user = userEvent.setup();
    const { mutateAlias } = renderPanel();

    await user.type(screen.getByLabelText(`Add an alias for ${EMAIL}`), ALIAS);
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mutateAlias).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`Add an alias for ${EMAIL}`)).toBeInTheDocument();
  });

  it("reports an empty submit rather than doing nothing", async () => {
    const user = userEvent.setup();
    const { mutateAlias, onNotice } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Add alias" }));

    expect(onNotice).toHaveBeenCalledWith("Type the address to add as an alias.");
    expect(mutateAlias).not.toHaveBeenCalled();
  });

  it("reports an address that already resolves here instead of asking to confirm it", async () => {
    const user = userEvent.setup();
    const { mutateAlias, onNotice } = renderPanel({ aliases: [ALIAS] });

    await user.type(screen.getByLabelText(`Add an alias for ${EMAIL}`), ALIAS);
    await user.click(screen.getByRole("button", { name: "Add alias" }));

    expect(onNotice).toHaveBeenCalledWith(`${ALIAS} already resolves to ${EMAIL}.`);
    expect(mutateAlias).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("removes an alias in one step, because removing only ever narrows", async () => {
    const user = userEvent.setup();
    const { mutateAlias } = renderPanel({ aliases: [ALIAS] });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(mutateAlias).toHaveBeenCalledWith("removeAlias", EMAIL, ALIAS);
  });

  it("disables both controls while a change is in flight", () => {
    renderPanel({ aliases: [ALIAS], pending: true });

    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add alias" })).toBeDisabled();
  });
});
