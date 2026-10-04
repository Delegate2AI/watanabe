// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocEditor } from "./doc-editor";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("DocEditor", () => {
  it("edits the raw markdown source when the rich editor is off", async () => {
    render(<DocEditor id="d1" initialBody="## Heading" canEdit />);
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const raw = screen.getByRole("textbox");
    expect(raw.tagName).toBe("TEXTAREA");
    expect(raw).toHaveValue("## Heading");
    expect(screen.queryByRole("button", { name: /^markdown$/i })).not.toBeInTheDocument();
  });

  it("offers the rich editor when the flag is on", async () => {
    render(<DocEditor id="d1" initialBody="## Heading" canEdit richEditorEnabled />);
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /^markdown$/i })).toBeInTheDocument();
    const rich = await screen.findByLabelText("Document body");
    expect(rich).toHaveAttribute("contenteditable", "true");
    expect(within(rich).getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
  });

  it("saves what was authored in rich mode as markdown", async () => {
    render(<DocEditor id="d1" initialBody="## Heading" canEdit richEditorEnabled />);
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByLabelText("Document body");
    await userEvent.click(screen.getByRole("button", { name: /save version/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/d1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ body: "## Heading" }) }),
    );
  });
});
