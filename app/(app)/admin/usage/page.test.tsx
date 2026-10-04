// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const resolveIdentityMock = vi.fn();
const canMock = vi.fn();
const summarizeUsageMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args) }));
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/service/actor", () => ({ actorFor: (email: string) => ({ email, clearance: [], groups: {}, can: () => true }) }));
vi.mock("@/lib/usage/service/usage", () => ({ summarizeUsage: (...args: unknown[]) => summarizeUsageMock(...args) }));
vi.mock("@/lib/people/resolve", () => ({ resolvePeople: () => ({}) }));

import Page from "./page";

const SUMMARY = {
  from: "2026-08-09",
  to: "2026-09-07",
  users: { turns: 3, inputTokens: 300, outputTokens: 60, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 4.5 },
  system: { turns: 2, inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25 },
  grand: { turns: 5, inputTokens: 500, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 5.75 },
  owners: [
    {
      ownerEmail: "alice@example.com",
      topModel: "claude-opus-4-8",
      turns: 3,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 4.5,
    },
  ],
  sources: [
    {
      source: "meetings",
      turns: 2,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.25,
    },
  ],
  models: [
    {
      model: "claude-opus-4-8",
      turns: 5,
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 5.75,
    },
  ],
};

const saved = { ...process.env };

beforeEach(() => {
  process.env.USAGE_AUDIT_ENABLED = "1";
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "admin@example.com" });
  canMock.mockReset().mockReturnValue(true);
  summarizeUsageMock.mockReset().mockReturnValue({ ok: true, value: SUMMARY });
  notFoundMock.mockClear();
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("UsageAdminPage", () => {
  it("renders the tiles and every table for an admin", async () => {
    const { container } = render(await Page());

    expect(container.textContent).toContain("Usage and cost");
    expect(container.textContent).toContain("$5.75");
    expect(container.textContent).toContain("$4.50");
    expect(container.textContent).toContain("$1.25");
    expect(container.textContent).toContain("alice@example.com");
    expect(container.textContent).toContain("meetings");
    expect(container.textContent).toContain("claude-opus-4-8");
    expect(container.textContent).toMatch(/UTC/);
  });

  it("404s for a viewer without manageAccess", async () => {
    canMock.mockReturnValue(false);

    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s with the flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when the service refuses", async () => {
    summarizeUsageMock.mockReturnValue({ ok: false, code: "needs_role" });

    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("keeps a slow drill-down from overwriting the owner expanded after it", async () => {
    summarizeUsageMock.mockReturnValue({
      ok: true,
      value: {
        ...SUMMARY,
        owners: [
          { ...SUMMARY.owners[0] },
          {
            ownerEmail: "bob@example.com",
            topModel: "claude-opus-4-8",
            turns: 2,
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 1.1,
          },
        ],
      },
    });

    let resolveAlice!: (value: unknown) => void;
    let resolveBob!: (value: unknown) => void;
    const aliceFetch = new Promise((resolve) => {
      resolveAlice = resolve;
    });
    const bobFetch = new Promise((resolve) => {
      resolveBob = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("owner=alice%40example.com")) return aliceFetch;
      if (url.includes("owner=bob%40example.com")) return bobFetch;
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(await Page());

    await userEvent.click(screen.getByRole("button", { name: "alice@example.com" }));
    await userEvent.click(screen.getByRole("button", { name: "bob@example.com" }));

    resolveBob({
      ok: true,
      json: async () => ({
        threads: [
          { threadId: "bob-thread", source: "chat", title: "Bob's thread", turns: 1, costUsd: 1.1, lastAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
    });
    await screen.findByText("Bob's thread");

    resolveAlice({
      ok: true,
      json: async () => ({
        threads: [
          { threadId: "alice-thread", source: "chat", title: "Alice's thread", turns: 3, costUsd: 4.5, lastAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Bob's thread")).toBeInTheDocument();
    expect(screen.queryByText("Alice's thread")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("keeps a period reload when an owner is toggled while it is in flight", async () => {
    let resolveSummary!: (value: unknown) => void;
    const summaryFetch = new Promise((resolve) => {
      resolveSummary = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("view=threads")) return Promise.resolve({ ok: true, json: async () => ({ threads: [] }) });
      return summaryFetch;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(await Page());

    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    await userEvent.click(screen.getByRole("button", { name: "alice@example.com" }));

    resolveSummary({
      ok: true,
      json: async () => ({ ...SUMMARY, grand: { ...SUMMARY.grand, costUsd: 9.99 } }),
    });
    await screen.findByText("$9.99");

    expect(screen.getByRole("button", { name: "7 days" })).toBeEnabled();

    vi.unstubAllGlobals();
  });
});
