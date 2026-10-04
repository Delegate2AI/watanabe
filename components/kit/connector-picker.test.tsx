// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectorPicker } from "./connector-picker";
import { notifyFailure } from "@/lib/ui/toast";
import { messageFor } from "@/lib/errors/messages";

vi.mock("@/lib/ui/toast", () => ({
  notifySuccess: vi.fn(),
  notifyFailure: vi.fn(),
}));

const CONNECTORS = [
  { slug: "linear", title: "Linear", transport: "http" },
  { slug: "sentry", title: "Sentry", transport: "sse" },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Stub fetch for the picker's three calls: the connector list, the thread's
 * enabled slugs, and the PUT toggle. Each is overridable per test.
 */
function stubFetch(handlers: {
  list?: () => Response;
  threadGet?: () => Response;
  put?: (body: { slug: string; enabled: boolean }) => Response | Promise<Response>;
} = {}) {
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/connectors") return handlers.list?.() ?? json({ connectors: CONNECTORS });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { slug: string; enabled: boolean };
      return handlers.put?.(body) ?? json({ enabled: body.enabled ? [body.slug] : [] });
    }
    return handlers.threadGet?.() ?? json({ enabled: [] });
  });
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return impl;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ConnectorPicker", () => {
  it("renders nothing when the caller is cleared for zero connectors", async () => {
    const impl = stubFetch({ list: () => json({ connectors: [] }) });
    const { container } = render(<ConnectorPicker threadId="t1" />);
    await waitFor(() => expect(impl).toHaveBeenCalledWith("/api/connectors"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a count badge from the INTERSECTION of stored and offered slugs", async () => {
    // The stored set is raw: "retired-tool" is no longer in the registry and
    // must not be counted.
    stubFetch({ threadGet: () => json({ enabled: ["linear", "retired-tool"] }) });
    render(<ConnectorPicker threadId="t1" />);
    const button = await screen.findByRole("button", { name: /connectors/i });
    expect(button).toBeEnabled();
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("toggling a row flips it optimistically and PUTs the change", async () => {
    const user = userEvent.setup();
    // A PUT that never settles: the flip below can only be the optimistic one.
    const impl = stubFetch({ put: () => new Promise<Response>(() => {}) });
    render(<ConnectorPicker threadId="t1" />);
    await user.click(await screen.findByRole("button", { name: /connectors/i }));
    const row = screen.getByRole("menuitemcheckbox", { name: /linear/i });
    expect(row).toHaveAttribute("aria-checked", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith(
        "/api/threads/t1/connectors",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ slug: "linear", enabled: true }),
        }),
      ),
    );
  });

  it("reverts the flip and toasts messageFor(code) when the PUT fails", async () => {
    const user = userEvent.setup();
    stubFetch({ put: () => json({ error: { code: "not_cleared" } }, 403) });
    render(<ConnectorPicker threadId="t1" />);
    await user.click(await screen.findByRole("button", { name: /connectors/i }));
    const row = screen.getByRole("menuitemcheckbox", { name: /linear/i });
    await user.click(row);
    await waitFor(() => expect(notifyFailure).toHaveBeenCalledWith(messageFor("not_cleared")));
    expect(row).toHaveAttribute("aria-checked", "false");
  });

  it("renders an oauth connector without a credential as a locked row with a Connect first link", async () => {
    stubFetch({
      list: () =>
        json({
          connectors: [
            { slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: false },
            { slug: "sentry", title: "Sentry", transport: "sse" },
          ],
        }),
    });
    const user = userEvent.setup();
    render(<ConnectorPicker threadId="t1" />);
    await user.click(await screen.findByRole("button", { name: /connectors/i }));

    expect(screen.queryByRole("menuitemcheckbox", { name: /linear/i })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /connect first/i });
    expect(link).toHaveAttribute("href", "/connectors");
    expect(screen.getByRole("menuitemcheckbox", { name: /sentry/i })).toBeInTheDocument();
  });

  it("renders a connected oauth connector as a normal toggleable row", async () => {
    const user = userEvent.setup();
    const impl = stubFetch({
      list: () =>
        json({
          connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: true }],
        }),
    });
    render(<ConnectorPicker threadId="t1" />);
    await user.click(await screen.findByRole("button", { name: /connectors/i }));
    const row = screen.getByRole("menuitemcheckbox", { name: /linear/i });
    await user.click(row);
    expect(row).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith(
        "/api/threads/t1/connectors",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("renders a disabled button with a hint when there is no thread yet", async () => {
    const impl = stubFetch();
    render(<ConnectorPicker threadId={null} />);
    const button = await screen.findByRole("button", { name: /connectors/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/send a message first/i));
    // No thread, so no thread-scoped read either.
    expect(impl).not.toHaveBeenCalledWith("/api/threads/null/connectors", expect.anything());
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
