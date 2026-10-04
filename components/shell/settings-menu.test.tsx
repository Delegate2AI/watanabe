// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsMenu } from "./settings-menu";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * jsdom does not implement HTMLFormElement.requestSubmit, so vi.spyOn (which
 * wraps an existing function) has nothing to wrap unless one is defined
 * first. Defined once here and restored after each test that uses it.
 */
function spyOnRequestSubmit() {
  if (!HTMLFormElement.prototype.requestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function stubRequestSubmit() {
      /* no-op stub; real submission is never exercised under jsdom */
    };
  }
  return vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
}

function renderMenu() {
  return render(
    <ThemeProvider>
      <SettingsMenu name="Nick" />
    </ThemeProvider>,
  );
}

describe("SettingsMenu", () => {
  it("opens with theme choices, the default model, and a sign-out link", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    // Default model section renders a model + level.
    expect(screen.getByText("Default model")).toBeInTheDocument();
    // Sign out is a real link (rendered via asChild), not a disabled stub.
    const signOut = screen.getByRole("menuitem", { name: /sign out/i });
    expect(signOut).toHaveAttribute("href", "/oauth2/sign_out");
  });

  it("switches the theme when a choice is selected", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("menuitem", { name: /^Dark$/i }));
    // next-themes writes the chosen theme onto <html data-theme>.
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("sign out", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the logout form via requestSubmit on a mouse click", async () => {
    const requestSubmit = spyOnRequestSubmit();
    const user = userEvent.setup();
    render(<SettingsMenu name="Ada" oidcSignOut />);
    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits the logout form via requestSubmit on keyboard Enter", async () => {
    // This is the regression case: Radix's DropdownMenuItem keydown handler
    // used to call the item's click(), and a <form>'s click() has no
    // activation behavior, so Enter and Space were silently dead.
    const requestSubmit = spyOnRequestSubmit();
    const user = userEvent.setup();
    render(<SettingsMenu name="Ada" oidcSignOut />);
    await user.click(screen.getByRole("button", { name: /settings/i }));
    const item = screen.getByRole("menuitem", { name: /sign out/i });
    item.focus();
    await user.keyboard("{Enter}");
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  // The caption used to promise a per-chat switch unconditionally, so on a
  // deployment with no model allowlist it pointed at a composer chip that is
  // inert by design and read as broken.
  it("only points at the composer's model switch when this deployment has one", async () => {
    render(<SettingsMenu name="Ada" modelSwitchingEnabled />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByText(/switch models for a single chat from the composer/i)).toBeInTheDocument();
  });

  it("says there is nothing to switch to when no allowlist is configured", async () => {
    render(<SettingsMenu name="Ada" />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(screen.getByText(/no other model to switch to/i)).toBeInTheDocument();
    expect(screen.queryByText(/from the composer/i)).not.toBeInTheDocument();
  });

  it("keeps the proxy sign-out link otherwise", async () => {
    render(<SettingsMenu name="Ada" />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    // Radix's `asChild` merges its own `role="menuitem"` onto this anchor,
    // which is why the sibling test above also queries "menuitem" rather than
    // the anchor's implicit "link" role.
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toHaveAttribute(
      "href",
      "/oauth2/sign_out",
    );
  });
});
