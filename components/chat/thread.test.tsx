// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Thread } from "./thread";
import { IdentityProvider } from "@/components/identity-provider";
import { resolveStubIdentity } from "@/lib/identity/stub";
import type { AgentEvent } from "@/lib/agent/events";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

function ndjson(events: AgentEvent[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status });
}

/** A hydrate call (GET) 404s (fresh thread) and the POST streams `events`. */
function stubFetch(events: AgentEvent[]) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith("/api/agent/sessions?id=")) {
      return new Response(JSON.stringify({ error: "gone" }), { status: 404 });
    }
    if (url === "/api/agent" && init?.method === "POST") return ndjson(events);
    if (url === "/api/artifacts" && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "art-1" }), { status: 201 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

function renderThread(initialQuery?: string, artifactsEnabled = false) {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <Thread id="t1" initialQuery={initialQuery} artifactsEnabled={artifactsEnabled} />
    </IdentityProvider>,
  );
}

function renderThreadWithChoice(initialChoice: {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}) {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <Thread
        id="t1"
        initialQuery="hi"
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-fable-5-1", label: "Fable 5.1" },
        ]}
        modelSwitchingEnabled
        initialChoice={initialChoice}
      />
    </IdentityProvider>,
  );
}

const COMPLETED_TURN: AgentEvent[] = [
  { type: "session", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { type: "text_delta", delta: "A substantial answer." },
  { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
];

describe("Thread (live runtime)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/chat/t1");
  });
  afterEach(() => vi.restoreAllMocks());

  it("streams the seed question's answer end to end", async () => {
    stubFetch([
      { type: "session", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { type: "text_delta", delta: "The payout model " },
      { type: "text_delta", delta: "changed in Q3." },
      { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
    ]);
    renderThread("what changed in payouts?");
    expect(await screen.findByText("what changed in payouts?")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("The payout model changed in Q3.")).toBeInTheDocument(),
    );
  });

  it("follows the streaming transcript to the bottom with an instant scroll", async () => {
    // jsdom has no scrollIntoView; the spy doubles as the assertion point.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    stubFetch(COMPLETED_TURN);
    renderThread("what changed?");
    await waitFor(() => expect(screen.getByText("A substantial answer.")).toBeInTheDocument());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
  });

  it("offers Save as artifact on a completed assistant turn when ARTIFACTS_ENABLED, and POSTs the turn body + live thread id", async () => {
    const mock = stubFetch(COMPLETED_TURN);
    const user = userEvent.setup();
    renderThread("what changed?", true);
    await waitFor(() => expect(screen.getByText("A substantial answer.")).toBeInTheDocument());
    const save = await screen.findByRole("button", { name: /save as artifact/i });
    await user.click(save);
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          ([url, init]) =>
            url === "/api/artifacts" &&
            (init as RequestInit | undefined)?.method === "POST" &&
            typeof (init as RequestInit)?.body === "string" &&
            ((init as RequestInit).body as string).includes("A substantial answer.") &&
            ((init as RequestInit).body as string).includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        ),
      ).toBe(true),
    );
    // The save now confirms visibly and links to the created artifact, instead
    // of the old silent fire-and-forget.
    expect(await screen.findByText(/saved as artifact/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute("href", "/artifacts/art-1");
  });

  it("does NOT offer Save as artifact when the flag is off (byte-identical turn)", async () => {
    stubFetch(COMPLETED_TURN);
    renderThread("what changed?", false);
    await waitFor(() => expect(screen.getByText("A substantial answer.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /save as artifact/i })).not.toBeInTheDocument();
  });

  it("does NOT re-send the seed when back/forward restores an already-adopted entry", async () => {
    // Reproduces the duplicate-thread bug: the entry keeps its `?q=` router
    // tree (so the route id is still the client handle) while the address bar
    // was swapped to the real SDK id. The old per-mount ref saw a fresh
    // component and sent again, minting a second thread per traversal.
    const mock = stubFetch(COMPLETED_TURN);
    window.history.replaceState(null, "", "/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    renderThread("what changed?");
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    expect(
      mock.mock.calls.filter(([url, init]) => url === "/api/agent" && (init as RequestInit)?.method === "POST"),
    ).toHaveLength(0);
  });

  it("does NOT re-send the seed when it already fired in this tab but has no session id yet", async () => {
    // The window the address bar cannot cover: leaving and returning before the
    // `session` event arrives, so the URL still reads as the client handle.
    const mock = stubFetch(COMPLETED_TURN);
    sessionStorage.setItem("chat-seed:t1", "pending");
    renderThread("what changed?");
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    expect(
      mock.mock.calls.filter(([url, init]) => url === "/api/agent" && (init as RequestInit)?.method === "POST"),
    ).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("records the adopted session id so a later restore can resume it", async () => {
    stubFetch(COMPLETED_TURN);
    renderThread("what changed?");
    await waitFor(() => expect(screen.getByText("A substantial answer.")).toBeInTheDocument());
    expect(sessionStorage.getItem("chat-seed:t1")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("appends a reply when the sticky composer is submitted", async () => {
    stubFetch([
      { type: "text_delta", delta: "ok" },
      { type: "turn_result", ok: true, costUsd: 0, sessionCostUsd: 0, durationMs: 1 },
    ]);
    const user = userEvent.setup();
    renderThread();
    await user.type(screen.getByRole("textbox"), "a follow up");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText("a follow up")).toBeInTheDocument();
  });

  it("shows the model chosen on Home rather than the allowlist default", async () => {
    stubFetch(COMPLETED_TURN);
    renderThreadWithChoice({ model: "claude-fable-5-1", effort: "max" });

    const chip = await screen.findByRole("button", { name: /model and reasoning level/i });
    expect(chip).toHaveTextContent("Fable 5.1");
    expect(chip).toHaveTextContent("Max");
  });

  it("falls back to the allowlist default when Home carried no choice", async () => {
    stubFetch(COMPLETED_TURN);
    renderThreadWithChoice({});

    const chip = await screen.findByRole("button", { name: /model and reasoning level/i });
    expect(chip).toHaveTextContent("Opus 4.8");
    expect(chip).toHaveTextContent("High");
  });
});
