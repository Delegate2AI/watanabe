// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadRow } from "./thread-row";

describe("ThreadRow", () => {
  it("renders the thread title as a link", () => {
    render(<ThreadRow title="meridian" href="/chat/1" />);
    expect(screen.getByRole("link", { name: /meridian/i })).toHaveAttribute(
      "href",
      "/chat/1",
    );
  });

  it("shows a lock only for a restricted thread", () => {
    const { rerender } = render(
      <ThreadRow title="Open thread" href="/chat/1" />,
    );
    expect(screen.queryByLabelText(/restricted/i)).toBeNull();

    rerender(
      <ThreadRow title="Q3 exec sync" href="/chat/2" restricted />,
    );
    expect(screen.getByLabelText(/restricted/i)).toBeInTheDocument();
  });

  it("shows no options menu when no management handlers are given (read-only row)", () => {
    render(<ThreadRow title="meridian" href="/chat/1" />);
    expect(screen.queryByRole("button", { name: /options for/i })).toBeNull();
  });

  it("pins from the row menu, and labels the toggle by current state", async () => {
    const onPin = vi.fn();
    const { rerender } = render(<ThreadRow title="meridian" href="/chat/1" onPin={onPin} />);
    await userEvent.click(screen.getByRole("button", { name: /options for meridian/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(onPin).toHaveBeenCalledWith(true);

    rerender(<ThreadRow title="meridian" href="/chat/1" pinned onPin={onPin} />);
    await userEvent.click(screen.getByRole("button", { name: /options for meridian/i }));
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeInTheDocument();
  });

  it("renames inline from the row menu", async () => {
    const onRename = vi.fn();
    render(<ThreadRow title="old name" href="/chat/1" onRename={onRename} />);
    await userEvent.click(screen.getByRole("button", { name: /options for old name/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: /rename old name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "new name{Enter}");
    expect(onRename).toHaveBeenCalledWith("new name");
  });

  it("deletes only after a second confirming click", async () => {
    const onDelete = vi.fn();
    render(<ThreadRow title="meridian" href="/chat/1" onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /options for meridian/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    // First click asks for confirmation, does not delete.
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("menuitem", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
