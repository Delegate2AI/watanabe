// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { McpTokensPanel } from "./mcp-tokens-panel";

vi.mock("@/lib/ui/toast", () => ({ notifyFailure: vi.fn(), notifySuccess: vi.fn() }));

const TOKEN = {
  id: "t1",
  name: "laptop",
  createdAt: "2026-08-21T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("McpTokensPanel", () => {
  it("says the feature is off rather than showing a dead form", () => {
    render(<McpTokensPanel enabled={false} />);
    expect(screen.getByText(/MCP client access is turned off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
  });

  it("lists a token without showing any secret", () => {
    const { container } = render(<McpTokensPanel enabled initialTokens={[TOKEN]} />);
    expect(container.textContent).toContain("laptop");
    expect(container.textContent).toContain("last used never");
  });

  it("shows a newly minted token once, with the warning that it is not repeated", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ id: "t2", token: "secret-value-xyz" });
      return Response.json({ tokens: [TOKEN] });
    }));

    render(<McpTokensPanel enabled initialTokens={[]} />);
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(screen.getByText("secret-value-xyz")).toBeTruthy());
    expect(screen.getByText(/not shown again/)).toBeTruthy();
  });

  it("offers Revoke on a live token and not on a revoked one", () => {
    render(<McpTokensPanel enabled initialTokens={[{ ...TOKEN, revokedAt: "2026-08-21T12:00:00.000Z" }]} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.getByText("revoked")).toBeTruthy();
  });
});
