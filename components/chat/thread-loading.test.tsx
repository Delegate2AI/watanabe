// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Thread } from "./thread";
import { IdentityProvider } from "@/components/identity-provider";
import { resolveStubIdentity } from "@/lib/identity/stub";
import type { Turn } from "@/lib/agent/conversation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const EMPTY_STATE = /ask watanabe anything about the knowledge base/i;

const TURNS: Turn[] = [
  { id: "u1", role: "user", content: "what changed in payouts?" },
  {
    id: "a1",
    role: "assistant",
    status: "done",
    segments: [{ kind: "text", text: "The payout model changed in Q3." }],
  },
];

/**
 * Resume-mode fetch: the transcript request resolves only when `release` is
 * called, so the test can inspect what the thread renders WHILE it is loading.
 */
function stubHydrate(turns: Turn[]) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/api/agent/sessions?id=")) {
        await gate;
        return new Response(JSON.stringify({ turns }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  );
  return () => release?.();
}

function renderThread() {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <Thread id="t1" />
    </IdentityProvider>,
  );
}

describe("Thread loading state", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a skeleton, not the empty state, while an existing thread hydrates", async () => {
    const release = stubHydrate(TURNS);
    renderThread();
    expect(screen.getByRole("status")).toHaveAccessibleName(/loading/i);
    expect(screen.queryByText(EMPTY_STATE)).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getByText("The payout model changed in Q3.")).toBeInTheDocument());
  });

  it("never renders the empty-state sentence at any point in a thread that has content", async () => {
    const release = stubHydrate(TURNS);
    renderThread();
    // Poll across the whole load: the old bug showed the empty state for seconds
    // before the messages arrived, so one assertion after settling would miss it.
    const seen: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(screen.queryByText(EMPTY_STATE) !== null);
      await new Promise((r) => setTimeout(r, 5));
    }
    release();
    await waitFor(() => expect(screen.getByText("The payout model changed in Q3.")).toBeInTheDocument());
    seen.push(screen.queryByText(EMPTY_STATE) !== null);
    expect(seen).not.toContain(true);
  });

  it("shows the empty state once a genuinely empty thread has finished loading", async () => {
    const release = stubHydrate([]);
    renderThread();
    expect(screen.queryByText(EMPTY_STATE)).not.toBeInTheDocument();
    release();
    expect(await screen.findByText(EMPTY_STATE)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops loading and shows the empty state when the transcript request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    );
    renderThread();
    expect(await screen.findByText(EMPTY_STATE)).toBeInTheDocument();
  });

  it("does not render a loading skeleton for a brand new thread", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    );
    render(
      <IdentityProvider identity={resolveStubIdentity()}>
        <Thread id="t2" initialQuery="hello" />
      </IdentityProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
