// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/ui/toast", () => ({ notifySuccess: vi.fn(), notifyFailure: vi.fn() }));

import { BudgetsPanel } from "./budgets-panel";
import { GroupsPanel } from "./groups-panel";
import { RequestsPanel } from "./requests-panel";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => vi.unstubAllGlobals());

const body = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);
const group = { slug: "paid", label: "Paid", models: ["anthropic/*"], defaultTokens: 1000, period: "month" as const };

describe("RequestsPanel", () => {
  it("decides a pending request with the edited amount and note", async () => {
    render(
      <RequestsPanel
        requests={[{
          id: "r1", requesterEmail: "ana@corp.io", groupSlug: "paid", groupLabel: "Paid", requestedTokens: 5000, reason: "release",
          status: "pending", decision: null, grantedTokens: null, decidedBy: null, decisionNote: null, createdAt: "t",
          used: 900, limit: 1000, period: "month",
        }]}
      />,
    );
    expect(screen.getByText(/now 900 of 1k per month/)).toBeTruthy();
    const amount = screen.getByLabelText("Tokens to grant");
    await userEvent.clear(amount);
    await userEvent.type(amount, "2000");
    await userEvent.type(screen.getByPlaceholderText(/note/i), "ok");
    await userEvent.click(screen.getByRole("button", { name: /top up this month/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/llm/requests");
    expect(body()).toEqual({ id: "r1", action: "approve_top_up", tokens: 2000, note: "ok" });
  });
});

describe("BudgetsPanel", () => {
  it("edits a team cell to unlimited per week", async () => {
    render(<BudgetsPanel teams={["all-hands", "eng"]} groups={[group]} budgets={[]} />);
    await userEvent.click(screen.getAllByRole("button", { name: "default" })[1]);
    await userEvent.selectOptions(screen.getByLabelText("Budget kind"), "unlimited");
    await userEvent.selectOptions(screen.getByLabelText("Period"), "week");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(body()).toEqual({ subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: null, period: "week", allowed: true });
  });
});

describe("GroupsPanel", () => {
  it("creates a group from one pattern per line, blank default meaning unlimited, and flags unmatched models", async () => {
    render(<GroupsPanel groups={[group]} seenModels={["anthropic/x", "ollama/qwen3"]} />);
    expect(screen.getByText(/in no group: blocked/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /new group/i }));
    await userEvent.type(screen.getByLabelText("Slug"), "local");
    await userEvent.type(screen.getByLabelText("Label"), "Local GPU");
    await userEvent.type(screen.getByLabelText("Model patterns"), "ollama/*{enter} {enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(body()).toEqual({ slug: "local", label: "Local GPU", models: ["ollama/*"], defaultTokens: null, period: "month" });
  });
});
