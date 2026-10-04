// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectorDirectory } from "./directory";

const CONNECTORS = [
  { slug: "linear", title: "Linear", transport: "http", description: "Track issues", icon: "chart" },
  { slug: "sentry", title: "Sentry", transport: "sse" },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(
  handlers: {
    list?: () => Response;
    post?: (body: { text: string }) => Response;
    oauthStart?: () => Response;
    oauthStop?: () => Response;
  } = {},
) {
  let listCalls = 0;
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/connectors") {
      listCalls += 1;
      return handlers.list?.() ?? json({ connectors: CONNECTORS });
    }
    if (url === "/api/connectors/requests" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { text: string };
      return handlers.post?.(body) ?? json({ id: "r1" });
    }
    if (typeof url === "string" && url.startsWith("/api/connectors/") && url.endsWith("/oauth")) {
      if (init?.method === "DELETE") return handlers.oauthStop?.() ?? json({ disconnected: true });
      return handlers.oauthStart?.() ?? json({ redirect: "https://idp.example.com/authorize" });
    }
    return json({});
  });
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return { impl, listCalls: () => listCalls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/connectors");
});

describe("ConnectorDirectory", () => {
  it("renders a card per connector with title, description, icon glyph, and a link to open it in a new chat", async () => {
    stubFetch();
    render(<ConnectorDirectory />);

    expect(await screen.findByText("Linear")).toBeInTheDocument();
    expect(screen.getByText("Sentry")).toBeInTheDocument();
    expect(screen.getByText("Track issues")).toBeInTheDocument();
    expect(screen.getByText("📊")).toBeInTheDocument();
    expect(screen.getByText("🔌")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /use in a new chat/i });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/?connector=linear",
      "/?connector=sentry",
    ]);
  });

  it("shows nothing to request access to when the caller is cleared for zero connectors", async () => {
    stubFetch({ list: () => json({ connectors: [] }) });
    render(<ConnectorDirectory />);
    expect(await screen.findByText(/no connectors are available/i)).toBeInTheDocument();
  });

  it("posts trimmed request text and shows a confirmation", async () => {
    const { impl } = stubFetch();
    const user = userEvent.setup();
    render(<ConnectorDirectory />);

    await screen.findByText("Linear");
    await user.type(screen.getByLabelText(/ask for a connector/i), "  Please add Notion  ");
    await user.click(screen.getByRole("button", { name: /request a connector/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith(
        "/api/connectors/requests",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = impl.mock.calls.find(([url]) => url === "/api/connectors/requests");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ text: "Please add Notion" });
    expect(await screen.findByText(/thanks, we passed your request along/i)).toBeInTheDocument();
  });

  it("renders the failure and does not claim the request landed", async () => {
    stubFetch({ post: () => json({ error: { code: "invalid_request" } }, 400) });
    const user = userEvent.setup();
    render(<ConnectorDirectory />);

    await screen.findByText("Linear");
    await user.type(screen.getByLabelText(/ask for a connector/i), "Notion please");
    await user.click(screen.getByRole("button", { name: /request a connector/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/thanks, we passed your request along/i)).toBeNull();
  });

  it("shows an unavailable label with no buttons for an oauth connector when the oauth flag is off", async () => {
    stubFetch({
      list: () =>
        json({
          connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth" }],
        }),
    });
    render(<ConnectorDirectory />);

    await screen.findByText("Linear");
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^connect$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it("starts the oauth flow and follows the redirect when Connect is clicked", async () => {
    const { impl } = stubFetch({
      list: () =>
        json({
          connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: false }],
        }),
      oauthStart: () => json({ redirect: "https://idp.example.com/authorize?x=1" }),
    });
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign },
      writable: true,
      configurable: true,
    });

    const user = userEvent.setup();
    render(<ConnectorDirectory />);
    await screen.findByText("Linear");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith("/api/connectors/linear/oauth", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://idp.example.com/authorize?x=1"));

    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true });
  });

  it("shows a Connected badge and disconnects on confirm, then refetches the list", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    let connected = true;
    const { impl, listCalls } = stubFetch({
      list: () =>
        json({
          connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected }],
        }),
      oauthStop: () => {
        connected = false;
        return json({ disconnected: true });
      },
    });

    const user = userEvent.setup();
    render(<ConnectorDirectory />);
    await screen.findByText("Linear");
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith("/api/connectors/linear/oauth", expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(listCalls()).toBe(2));
    expect(await screen.findByRole("button", { name: /^connect$/i })).toBeInTheDocument();
  });

  it("does not disconnect when the confirmation is declined", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { impl } = stubFetch({
      list: () =>
        json({
          connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: true }],
        }),
    });

    const user = userEvent.setup();
    render(<ConnectorDirectory />);
    await screen.findByText("Linear");
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(impl).not.toHaveBeenCalledWith("/api/connectors/linear/oauth", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows a one-shot banner for ?connected=<slug> and strips the param", async () => {
    window.history.replaceState(null, "", "/connectors?connected=linear");
    stubFetch();
    render(<ConnectorDirectory />);

    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("shows a one-shot banner for ?error=oauth and strips the param", async () => {
    window.history.replaceState(null, "", "/connectors?error=oauth");
    stubFetch();
    render(<ConnectorDirectory />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });
});
