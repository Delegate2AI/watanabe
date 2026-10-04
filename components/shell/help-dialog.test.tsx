// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpDialog } from "./help-dialog";

describe("HelpDialog", () => {
  it("opens an about/feedback dialog from the help control", async () => {
    const user = userEvent.setup();
    render(<HelpDialog feedbackHref="mailto:team@example.com" />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText("About Watanabe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /send feedback/i })).toHaveAttribute(
      "href",
      "mailto:team@example.com",
    );
  });

  it("hides the feedback link when the deployment configures no address", async () => {
    const user = userEvent.setup();
    render(<HelpDialog />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText("About Watanabe")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send feedback/i })).toBeNull();
  });

  it("describes the workspace and the approver exception without absolute review claims", async () => {
    const user = userEvent.setup();
    render(<HelpDialog />);
    await user.click(screen.getByRole("button", { name: /help/i }));

    const dialog = screen.getByRole("dialog", { name: "About Watanabe" });
    expect(dialog).toHaveTextContent("Watanabe is your team's workspace.");
    // The copy no longer implies a KB doc has an in-place "propose edit" control
    // (there is none): it points at the real draft -> artifact -> review path.
    expect(dialog).toHaveTextContent("The knowledge base is read-only here");
    expect(dialog).toHaveTextContent("a reviewable merge request");
    expect(dialog).toHaveTextContent("Approvers can publish directly");
    expect(dialog.textContent?.toLowerCase()).not.toContain("never");
    expect(dialog.textContent?.toLowerCase()).not.toContain("nothing reaches");
  });
});
