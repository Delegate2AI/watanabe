// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "./model-selector";
import type { ModelOption } from "@/lib/agent/model-options";

const OPTIONS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Current default", tier: 2 },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable", tier: 3 },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("ModelSelector", () => {
  it("renders an inert label (no menu) when switching is disabled", async () => {
    const user = userEvent.setup();
    render(<ModelSelector threadId="t1" model="Opus 4.8" level="High" options={[]} enabled={false} />);
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // No interactive trigger exists when disabled.
    expect(screen.queryByRole("button", { name: /model and reasoning level/i })).not.toBeInTheDocument();
    await user.click(screen.getByText("Opus 4.8"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders an inert label when enabled but there is no thread yet", () => {
    render(<ModelSelector model="Opus 4.8" level="High" options={OPTIONS} enabled />);
    expect(screen.queryByRole("button", { name: /model and reasoning level/i })).not.toBeInTheDocument();
  });

  it("opens the menu and writes the chosen effort onto the thread via PATCH", async () => {
    const user = userEvent.setup();
    render(<ModelSelector threadId="t1" model="Opus 4.8" level="High" options={OPTIONS} enabled />);
    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitemradio", { name: /Low/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/threads/t1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ effort: "low" }) }),
      ),
    );
  });

  it("writes the chosen model id (not its label) to the thread", async () => {
    const user = userEvent.setup();
    render(<ModelSelector threadId="t1" model="Opus 4.8" level="High" options={OPTIONS} enabled />);
    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Sonnet 4.6/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/threads/t1",
        expect.objectContaining({ body: JSON.stringify({ model: "claude-sonnet-4-6" }) }),
      ),
    );
  });
});

describe("ModelSelector controlled mode", () => {
  it("is interactive without a thread when onChange is supplied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ModelSelector model="Opus 4.8" level="High" options={OPTIONS} enabled onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/i }));

    expect(onChange).toHaveBeenCalledWith({ model: "claude-fable-5-1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /model and reasoning level/i })).toHaveTextContent(
      "Fable 5.1",
    );
  });

  it("reports an effort change up through onChange with no thread to PATCH", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ModelSelector model="Opus 4.8" level="High" options={OPTIONS} enabled onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Low/i }));

    expect(onChange).toHaveBeenCalledWith({ effort: "low" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still PATCHes, and also reports, when both a thread and onChange are present", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ModelSelector
        threadId="t1"
        model="Opus 4.8"
        level="High"
        options={OPTIONS}
        enabled
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/i }));

    expect(onChange).toHaveBeenCalledWith({ model: "claude-fable-5-1" });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/threads/t1",
        expect.objectContaining({ body: JSON.stringify({ model: "claude-fable-5-1" }) }),
      ),
    );
  });

  it("stays inert when switching is off even with an onChange", () => {
    const onChange = vi.fn();
    render(
      <ModelSelector
        model="Opus 4.8"
        level="High"
        options={OPTIONS}
        enabled={false}
        onChange={onChange}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /model and reasoning level/i }),
    ).not.toBeInTheDocument();
  });

  it("follows a model and level prop that changes after mount", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelSelector model="Opus 4.8" level="High" options={OPTIONS} enabled onChange={onChange} />,
    );
    expect(screen.getByRole("button", { name: /model and reasoning level/i })).toHaveTextContent(
      "Opus 4.8",
    );

    rerender(
      <ModelSelector model="Fable 5.1" level="Max" options={OPTIONS} enabled onChange={onChange} />,
    );

    const chip = screen.getByRole("button", { name: /model and reasoning level/i });
    expect(chip).toHaveTextContent("Fable 5.1");
    expect(chip).toHaveTextContent("Max");
  });
});

describe("ModelSelector menu presentation", () => {
  it("shows the curated hint beside a table model and a cost-tier label", async () => {
    const user = userEvent.setup();
    render(<ModelSelector threadId="t1" model="Opus 4.8" level="High" options={OPTIONS} enabled />);

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));

    expect(screen.getByText("Most capable")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost tier 3 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost tier 2 of 3")).toBeInTheDocument();
  });

  it("renders an uncurated model with no hint and no tier", async () => {
    const user = userEvent.setup();
    render(<ModelSelector threadId="t1" model="Opus 4.8" level="High" options={OPTIONS} enabled />);

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));

    expect(screen.getByRole("menuitemradio", { name: /Sonnet 4\.6/i })).toHaveTextContent(
      "Sonnet 4.6",
    );
    expect(screen.queryByLabelText("Cost tier 1 of 3")).not.toBeInTheDocument();
  });
});
