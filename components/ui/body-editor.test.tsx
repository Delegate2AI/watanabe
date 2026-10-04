// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BodyEditor } from "./body-editor";

// TipTap is the app's heaviest client import and `BodyEditor` loads it
// lazily. Warm the module before the tests run, so the Suspense resolution
// the first test waits for is a cache hit rather than a cold ProseMirror
// import racing a findBy timeout on a loaded CI runner.
beforeAll(async () => {
  await import("./rich-editor");
});

const SUPPORTED = "## Heading\n\n**bold** text";
const WITH_TABLE = "Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";

function renderEditor(props: Partial<React.ComponentProps<typeof BodyEditor>> = {}) {
  return render(
    <BodyEditor value={SUPPORTED} onChange={() => {}} label="Artifact body" {...props} />,
  );
}

describe("BodyEditor", () => {
  it("opens in rich mode, rendering the markdown as real elements", async () => {
    renderEditor();
    const rich = await screen.findByLabelText("Artifact body", undefined, { timeout: 10000 });
    expect(rich).toHaveAttribute("contenteditable", "true");
    expect(within(rich).getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
    expect(within(rich).getByText("bold").tagName).toBe("STRONG");
    // The raw source is not on screen at the same time: one mode at a time.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("switches to markdown mode and hands back the raw source", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: /^markdown$/i }));
    const raw = screen.getByLabelText("Artifact body");
    expect(raw.tagName).toBe("TEXTAREA");
    expect(raw).toHaveValue(SUPPORTED);
  });

  it("reports every keystroke made in markdown mode", async () => {
    // Through a stateful owner, the way both real callers hold the body: a
    // controlled textarea whose `value` never advances would only ever report
    // one character.
    function Owner() {
      const [body, setBody] = useState("");
      return <BodyEditor value={body} onChange={setBody} label="Artifact body" />;
    }
    render(<Owner />);
    await userEvent.click(screen.getByRole("button", { name: /^markdown$/i }));
    await userEvent.type(screen.getByLabelText("Artifact body"), "hi");
    expect(screen.getByLabelText("Artifact body")).toHaveValue("hi");
  });

  it("opens in markdown mode and refuses rich mode for a body with a table", () => {
    renderEditor({ value: WITH_TABLE });
    expect(screen.getByLabelText("Artifact body").tagName).toBe("TEXTAREA");
    expect(screen.getByRole("button", { name: /^rich$/i })).toBeDisabled();
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });

  it("closes rich mode off once a table is typed into the markdown source", async () => {
    // Codex review: judging the body once at mount let an author switch to
    // markdown, add a table, switch back, and lose it on the next keystroke.
    function Owner() {
      const [body, setBody] = useState("Intro");
      return <BodyEditor value={body} onChange={setBody} label="Artifact body" />;
    }
    render(<Owner />);
    await userEvent.click(screen.getByRole("button", { name: /^markdown$/i }));
    expect(screen.getByRole("button", { name: /^rich$/i })).toBeEnabled();

    await userEvent.type(
      screen.getByLabelText("Artifact body"),
      "\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
    expect(screen.getByRole("button", { name: /^rich$/i })).toBeDisabled();
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });

  it("keeps the raw source editable when the rich editor is refused", async () => {
    const onChange = vi.fn();
    renderEditor({ value: WITH_TABLE, onChange });
    await userEvent.type(screen.getByLabelText("Artifact body"), "!");
    expect(onChange).toHaveBeenCalled();
  });

  it("disables editing when the body is locked", async () => {
    renderEditor({ disabled: true });
    await userEvent.click(screen.getByRole("button", { name: /^markdown$/i }));
    expect(screen.getByLabelText("Artifact body")).toBeDisabled();
  });
});
