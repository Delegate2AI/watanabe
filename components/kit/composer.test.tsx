// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./composer";

afterEach(() => vi.restoreAllMocks());

describe("Composer", () => {
  it("submits the typed value and clears the field on send", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Ask" />);

    const field = screen.getByRole("textbox");
    await user.type(field, "hello kb");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello kb");
    expect(field).toHaveValue("");
  });

  it("submits on Enter but not on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const field = screen.getByRole("textbox");

    await user.type(field, "line one{Shift>}{Enter}{/Shift}still typing");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(field, "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("line one\nstill typing");
  });

  it("does not submit whitespace-only input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders the model selector controls", () => {
    render(<Composer onSubmit={vi.fn()} />);
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("disables the attach button with a tooltip when attachments are off", () => {
    render(<Composer onSubmit={vi.fn()} threadId="t1" attachmentsEnabled={false} />);
    const attach = screen.getByRole("button", { name: /attach/i });
    expect(attach).toBeDisabled();
    expect(attach).toHaveAttribute("title", "Attachments are not enabled");
  });

  it("enables the attach button on Home when attachments are on and there is no thread yet", () => {
    render(<Composer onSubmit={vi.fn()} attachmentsEnabled />);
    expect(screen.getByRole("button", { name: /attach/i })).toBeEnabled();
  });

  it("keeps the attach button disabled when attachments are off", () => {
    render(<Composer onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /attach/i })).toBeDisabled();
  });

  it("disables the mic with a tooltip when dictation is not enabled", () => {
    render(<Composer onSubmit={vi.fn()} showMic dictationEnabled={false} />);
    const mic = screen.getByRole("button", { name: /dictate/i });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute("title", "Dictation is not enabled");
  });

  it("enables the mic when dictation is configured", () => {
    render(<Composer onSubmit={vi.fn()} showMic dictationEnabled />);
    expect(screen.getByRole("button", { name: /dictate/i })).toBeEnabled();
  });

  it("uploads a picked file and shows it as a removable chip", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            attachment: { type: "attachment", id: "a1", name: "notes.md", mimeType: "text/markdown", size: 5, threadId: "t1" },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );
    const { container } = render(<Composer onSubmit={vi.fn()} threadId="t1" attachmentsEnabled />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["hello"], "notes.md", { type: "text/markdown" }));
    expect(await screen.findByText("notes.md")).toBeInTheDocument();
    // The upload posted to the thread-scoped attachments route.
    expect(fetch).toHaveBeenCalledWith("/api/attachments", expect.objectContaining({ method: "POST" }));
    await user.click(screen.getByRole("button", { name: /remove notes.md/i }));
    await waitFor(() => expect(screen.queryByText("notes.md")).not.toBeInTheDocument());
  });

  it("shows an in-project affordance when a project is set AND projects are enabled (spec 26)", () => {
    const { container } = render(
      <Composer onSubmit={vi.fn()} projectId="p1" projectName="Q3 Launch" projectsEnabled />,
    );
    expect(screen.getByText(/In Q3 Launch/i)).toBeInTheDocument();
    expect(container.querySelector('[data-project-id="p1"]')).not.toBeNull();
  });

  it("renders neither chip nor data-project-id when projects are disabled, even with project props (flag-off byte-identical)", () => {
    const { container } = render(
      <Composer onSubmit={vi.fn()} projectId="p1" projectName="Q3 Launch" />,
    );
    expect(screen.queryByText(/In Q3 Launch/i)).not.toBeInTheDocument();
    expect(container.querySelector("[data-project-id]")).toBeNull();
  });

  it("shows no in-project affordance by default", () => {
    render(<Composer onSubmit={vi.fn()} />);
    expect(screen.queryByText(/^In /)).not.toBeInTheDocument();
  });

  it("seeds an empty field from a quick action", async () => {
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Explain ", nonce: 1 }} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Explain "));
  });

  // The chip seeded the field but left focus on itself, so the very next thing
  // typed went nowhere and the bare opener got sent instead.
  it("hands the caret to the field, at the end of the seed, so typing continues the sentence", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Help me write a doc about ", nonce: 1 }} />);

    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe("Help me write a doc about ".length);

    await user.keyboard("the payout model");
    expect(field).toHaveValue("Help me write a doc about the payout model");
  });

  it("keeps what the user typed when a quick action fires, instead of destroying it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    await user.type(screen.getByRole("textbox"), "the payout model");
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Help me write a doc about ", nonce: 1 }} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Help me write a doc about the payout model"),
    );
  });

  it("swaps one opener for another instead of stacking them (F-08)", async () => {
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Help me write a doc about ", nonce: 1 }} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Help me write a doc about "));
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Help me think through a strategy for ", nonce: 2 }} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Help me think through a strategy for "),
    );
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Explain ", nonce: 3 }} />);
    // Only the last opener, never the concatenation of all three.
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Explain "));
  });

  it("swaps the opener but keeps the words typed on top of a prior seed (F-08)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Help me write a doc about ", nonce: 1 }} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Help me write a doc about "));
    await user.type(screen.getByRole("textbox"), "the payout model");
    rerender(<Composer onSubmit={vi.fn()} prefill={{ text: "Explain ", nonce: 2 }} />);
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Explain the payout model"),
    );
  });

  it("ignores a prefill whose nonce has not changed, so typing is not clobbered on every render", async () => {
    const user = userEvent.setup();
    const prefill = { text: "Explain ", nonce: 1 };
    const { rerender } = render(<Composer onSubmit={vi.fn()} />);
    rerender(<Composer onSubmit={vi.fn()} prefill={prefill} />);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Explain "));
    await user.type(screen.getByRole("textbox"), "the economy");
    rerender(<Composer onSubmit={vi.fn()} prefill={prefill} />);
    expect(screen.getByRole("textbox")).toHaveValue("Explain the economy");
  });

  it("fires no second turn into a running one: send is unavailable and Enter does nothing while busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} busy onStop={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "a second question{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not gate send when no role is threaded (ROLES_ENABLED off, byte-identical)", () => {
    render(<Composer onSubmit={vi.fn()} />);
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeEnabled();
    // No title/disabled attributes are added, so the DOM matches today's.
    expect(send).not.toHaveAttribute("title");
    expect(send).not.toHaveAttribute("disabled");
  });

  it("renders no connectors control when connectors are disabled (flag-off byte-identical)", () => {
    render(<Composer onSubmit={vi.fn()} threadId="t1" />);
    expect(screen.queryByRole("button", { name: /connectors/i })).not.toBeInTheDocument();
  });

  it("renders the connector picker when connectors are enabled (spec 33)", async () => {
    // One body serves both picker reads: the list keys off `connectors`, the
    // thread state keys off `enabled`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            connectors: [{ slug: "linear", title: "Linear", transport: "http" }],
            enabled: [],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );
    render(<Composer onSubmit={vi.fn()} threadId="t1" connectorsEnabled />);
    expect(await screen.findByRole("button", { name: /connectors/i })).toBeInTheDocument();
  });

  it("reports a model choice up through onModelChange with no thread", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(
      <Composer
        onSubmit={vi.fn()}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-fable-5-1", label: "Fable 5.1" },
        ]}
        modelSwitchingEnabled
        onModelChange={onModelChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/i }));

    expect(onModelChange).toHaveBeenCalledWith({ model: "claude-fable-5-1" });
  });
});
