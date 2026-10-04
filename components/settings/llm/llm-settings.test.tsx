// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/ui/toast", () => ({ notifySuccess: vi.fn(), notifyFailure: vi.fn() }));

import { BudgetsPanel } from "./budgets-panel";
import { KeysPanel } from "./keys-panel";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => vi.unstubAllGlobals());

const key = {
  id: "k1", ownerEmail: "ana@corp.io", routerKeyId: "r1", keyHint: "wxyz", label: "laptop", status: "active" as const,
  createdAt: "2026-10-04T10:00:00.000Z", revokedAt: null, lastUsedAt: null,
};

describe("KeysPanel", () => {
  it("shows a new key once, then refreshes the list", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ key: "sk-9r-secret", record: key }), { status: 201 }));
    render(<KeysPanel keys={[]} />);
    await userEvent.type(screen.getByPlaceholderText(/label/i), "laptop");
    await userEvent.click(screen.getByRole("button", { name: /generate key/i }));
    expect(await screen.findByText("sk-9r-secret")).toBeTruthy();
    expect(screen.getByText(/shown once/i)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ label: "laptop" });
    expect(refresh).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /i have saved it/i }));
    expect(screen.queryByText("sk-9r-secret")).toBeNull();
  });

  it("generates with a dated default label when none is typed, so the button is never dead", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ key: "sk-9r-secret", record: key }), { status: 201 }));
    render(<KeysPanel keys={[]} />);
    const button = screen.getByRole("button", { name: /generate key/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).label).toMatch(/^key \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("revokes by id", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<KeysPanel keys={[key]} />);
    expect(screen.getByText("…wxyz")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/llm-keys?id=k1", { method: "DELETE" }));
  });
});

describe("BudgetsPanel", () => {
  const budget = {
    groupSlug: "paid", label: "Paid models", models: ["anthropic/*"], tokens: 1_000_000, period: "month" as const,
    resetAt: "2026-11-01T00:00:00.000Z", used: 950_000, bonus: 0,
  };

  it("shows usage against the limit and files a request for more", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ request: { id: "r1" } }), { status: 201 }));
    render(<BudgetsPanel budgets={[budget]} requests={[]} />);
    expect(screen.getByText(/950k of 1M per month/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("95");
    await userEvent.click(screen.getByRole("button", { name: /request more/i }));
    await userEvent.type(screen.getByPlaceholderText(/what is it for/i), "release week");
    await userEvent.click(screen.getByRole("button", { name: /send request/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ groupSlug: "paid", tokens: 1_000_000, reason: "release week" });
  });

  it("says unlimited and offers no request", () => {
    render(<BudgetsPanel budgets={[{ ...budget, tokens: null }]} requests={[]} />);
    expect(screen.getByText(/unlimited/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /request more/i })).toBeNull();
  });
});
