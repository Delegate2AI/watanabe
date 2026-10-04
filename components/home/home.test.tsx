// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

import { Home } from "./home";
import { IdentityProvider } from "@/components/identity-provider";
import { resolveStubIdentity } from "@/lib/identity/stub";
import { MODEL_CHOICE_KEY } from "@/lib/chat/model-choice";

const MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Current default", tier: 2 },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable", tier: 3 },
];

function renderHome() {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <Home />
    </IdentityProvider>,
  );
}

function renderHomeWithModels() {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <Home models={MODELS} modelSwitchingEnabled />
    </IdentityProvider>,
  );
}

describe("Home", () => {
  beforeEach(() => push.mockClear());

  it("greets the user by name from identity", () => {
    renderHome();
    expect(
      screen.getByRole("heading", { name: /Back at it, Nick/i }),
    ).toBeInTheDocument();
  });

  it("routes to a new chat thread on submit, carrying the message", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByRole("textbox"), "what changed in payouts?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(push).toHaveBeenCalledTimes(1);
    const target = push.mock.calls[0][0] as string;
    expect(target).toMatch(/^\/chat\/.+\?q=/);
    expect(target).toContain(encodeURIComponent("what changed in payouts?"));
  });

  it("lets a viewer send a chat message, since viewing and chatting is what the role is for", async () => {
    const user = userEvent.setup();
    render(
      <IdentityProvider identity={{ ...resolveStubIdentity(), role: "viewer" }}>
        <Home />
      </IdentityProvider>,
    );
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).not.toHaveAttribute("title");
    await user.type(screen.getByRole("textbox"), "what is in the kb?");
    await user.click(send);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("navigational chips link to their surface", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /find in the kb/i })).toHaveAttribute(
      "href",
      "/kb",
    );
    expect(screen.getByRole("link", { name: /my tasks/i })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("a generative chip prefills the composer", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: /write a doc/i }));
    expect(screen.getByRole("textbox")).toHaveValue("Help me write a doc about ");
  });

  it("a generative chip never discards what the user already typed", async () => {
    const user = userEvent.setup();
    renderHome();
    const field = screen.getByRole("textbox");
    await user.type(field, "the Q3 payout changes and how they affect trader score");
    await user.click(screen.getByRole("button", { name: /write a doc/i }));
    expect(field).toHaveValue(
      "Help me write a doc about the Q3 payout changes and how they affect trader score",
    );
  });

  it("keeps typed text through a second chip too", async () => {
    const user = userEvent.setup();
    renderHome();
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(field, "our pricing");
    await user.click(screen.getByRole("button", { name: /strategize/i }));
    await user.click(screen.getByRole("button", { name: /learn/i }));
    expect(field.value).toContain("our pricing");
  });
});

describe("Home model choice", () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it("lets the user pick a model before the first message and carries it in the URL", async () => {
    const user = userEvent.setup();
    renderHomeWithModels();

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/i }));
    await user.type(screen.getByRole("textbox"), "who owns payouts?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const target = push.mock.calls[0][0] as string;
    expect(target).toContain("&model=claude-fable-5-1");
  });

  it("carries a chosen effort too", async () => {
    const user = userEvent.setup();
    renderHomeWithModels();

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Low/i }));
    await user.type(screen.getByRole("textbox"), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(push.mock.calls[0][0] as string).toContain("&effort=low");
  });

  it("adds nothing to the URL when the user picks nothing", async () => {
    const user = userEvent.setup();
    renderHomeWithModels();

    await user.type(screen.getByRole("textbox"), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const target = push.mock.calls[0][0] as string;
    expect(target).not.toContain("&model=");
    expect(target).not.toContain("&effort=");
  });

  it("remembers the last choice in localStorage and restores it on the next visit", async () => {
    const user = userEvent.setup();
    const first = renderHomeWithModels();

    await user.click(screen.getByRole("button", { name: /model and reasoning level/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /Fable 5\.1/i }));
    await user.type(screen.getByRole("textbox"), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(window.localStorage.getItem(MODEL_CHOICE_KEY)).toContain("claude-fable-5-1");
    first.unmount();

    renderHomeWithModels();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /model and reasoning level/i })).toHaveTextContent(
        "Fable 5.1",
      ),
    );
  });

  it("ignores a stored model that is no longer on the allowlist", async () => {
    window.localStorage.setItem(MODEL_CHOICE_KEY, JSON.stringify({ model: "claude-retired-9" }));
    const user = userEvent.setup();
    renderHomeWithModels();

    await user.type(screen.getByRole("textbox"), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(push.mock.calls[0][0] as string).not.toContain("&model=");
  });
});

describe("the short-form content chip", () => {
  function renderHomeWith(shortFormContentEnabled: boolean) {
    return render(
      <IdentityProvider identity={resolveStubIdentity()}>
        <Home shortFormContentEnabled={shortFormContentEnabled} />
      </IdentityProvider>,
    );
  }

  it("appears when this deployment can actually generate copy", () => {
    renderHomeWith(true);
    expect(screen.getByText("Write a social post")).toBeTruthy();
  });

  it("is absent when the portal holds no content service key", () => {
    // A chip offering copy generation on a deployment that cannot generate any
    // is worse than no chip.
    renderHomeWith(false);
    expect(screen.queryByText("Write a social post")).toBeNull();
  });

  it("defaults to absent, so a caller that forgets the prop shows nothing", () => {
    render(
      <IdentityProvider identity={resolveStubIdentity()}>
        <Home />
      </IdentityProvider>,
    );
    expect(screen.queryByText("Write a social post")).toBeNull();
  });

  it("seeds the composer rather than navigating, since the request is composed in chat", async () => {
    // Generative, not navigational: the agent has to search the vault and put
    // the substance in key_points before it queues anything, so the request is
    // built in conversation rather than on a page of its own.
    const user = userEvent.setup();
    renderHomeWith(true);
    await user.click(screen.getByRole("button", { name: /write a social post/i }));
    expect(screen.getByRole("textbox")).toHaveValue("Draft three LinkedIn post variants about ");
  });
});
