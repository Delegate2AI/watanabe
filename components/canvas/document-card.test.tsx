// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentCard } from "./document-card";

describe("DocumentCard", () => {
  it("renders the title and current version", () => {
    render(<DocumentCard doc={{ docId: "d1", version: 3, title: "Risk memo" }} onOpen={() => {}} />);
    expect(screen.getByText("Risk memo")).toBeInTheDocument();
    expect(screen.getByText(/v3/)).toBeInTheDocument();
  });

  it("calls onOpen with the docId when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DocumentCard doc={{ docId: "d1", version: 1, title: "Draft" }} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /draft/i }));
    expect(onOpen).toHaveBeenCalledWith("d1");
  });
});
