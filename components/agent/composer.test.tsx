// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./composer";
import { AppConfigProvider } from "@/components/app-config-provider";
import { PortalConfigSchema } from "@/lib/config/schema";
import { toPublicConfig } from "@/lib/config/public";

const noop = () => {};

describe("agent Composer voice control", () => {
  it("disables the mic with a tooltip when dictation is not enabled", () => {
    render(<Composer onSend={noop} onStop={noop} busy={false} />);
    const mic = screen.getByRole("button", { name: "Dictate" });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute("title", "Dictation is not enabled");
  });

  it("enables the mic when dictation is enabled", () => {
    render(<Composer onSend={noop} onStop={noop} busy={false} dictationEnabled />);
    const mic = screen.getByRole("button", { name: "Dictate" });
    expect(mic).toBeEnabled();
    expect(mic).toHaveAttribute("title", "Dictate a message");
  });
});

describe("agent Composer starter prefill", () => {
  it("seeds an empty field", async () => {
    const { rerender } = render(<Composer onSend={noop} onStop={noop} busy={false} />);
    rerender(
      <Composer onSend={noop} onStop={noop} busy={false} prefill={{ text: "Explain ", nonce: 1 }} />,
    );
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Explain "));
  });

  it("keeps what the user typed when a starter card fires", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer onSend={noop} onStop={noop} busy={false} />);
    await user.type(screen.getByRole("textbox"), "the points economy");
    rerender(
      <Composer onSend={noop} onStop={noop} busy={false} prefill={{ text: "Explain ", nonce: 1 }} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Explain the points economy"),
    );
  });
});

describe("agent Composer model switch", () => {
  it("shows an interactive model selector when switching is on and a thread exists", () => {
    render(
      <Composer
        onSend={noop}
        onStop={noop}
        busy={false}
        modelThreadId="t1"
        models={[{ id: "claude-opus-4-8", label: "Opus 4.8" }]}
        modelSwitchingEnabled
      />,
    );
    expect(screen.getByRole("button", { name: "Model and reasoning level" })).toBeInTheDocument();
  });

  it("renders an inert model label when switching is off", () => {
    render(<Composer onSend={noop} onStop={noop} busy={false} />);
    expect(screen.queryByRole("button", { name: "Model and reasoning level" })).not.toBeInTheDocument();
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
  });
});

describe("agent Composer placeholder", () => {
  it("falls back to the neutral placeholder outside a provider", () => {
    render(<Composer onSend={noop} onStop={noop} busy={false} />);
    expect(screen.getByPlaceholderText("Ask anything about your knowledge base...")).toBeTruthy();
  });

  it("uses app.composerPlaceholder from the provider", () => {
    const config = toPublicConfig(PortalConfigSchema.parse({ app: { composerPlaceholder: "Ask the handbook" } }));
    render(
      <AppConfigProvider config={config}>
        <Composer onSend={noop} onStop={noop} busy={false} />
      </AppConfigProvider>,
    );
    expect(screen.getByPlaceholderText("Ask the handbook")).toBeTruthy();
  });
});
