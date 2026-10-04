// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsAdmin } from "./connectors-admin";
import type { ConnectorRow } from "./connectors-form";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const HTTP_ROW: ConnectorRow = {
  slug: "linear",
  status: "ok",
  title: "Linear",
  transport: "http",
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["exec"],
  tools: ["search_issues"],
  envVars: [{ name: "LINEAR_TOKEN", present: true }],
};

function renderAdmin(options: { entries?: ConnectorRow[]; groupNames?: string[] } = {}) {
  return render(
    <ConnectorsAdmin
      entries={options.entries ?? []}
      groupNames={options.groupNames ?? ["exec", "research"]}
    />,
  );
}

function bodyOf(call: number = 0): unknown {
  const posts = (fetch as unknown as { mock: { calls: [string, { body?: string }?][] } }).mock.calls
    .filter(([url, init]) => url === "/api/admin/connectors" && init?.body !== undefined);
  return JSON.parse((posts[call][1] as { body: string }).body);
}

beforeEach(() => {
  refreshMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("ConnectorsAdmin upsert payload", () => {
  it("posts the exact wire body for a new http connector", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "linear");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Linear");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://mcp.linear.app/mcp");
    await userEvent.type(
      screen.getByPlaceholderText("Authorization: Bearer ${EXAMPLE_TOKEN}"),
      "Authorization: Bearer ${{LINEAR_TOKEN}",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "exec" }));
    await userEvent.type(screen.getByPlaceholderText("search_issues, create_issue"), "search_issues, create_issue");
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/connectors",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          verb: "upsert",
          slug: "linear",
          entry: {
            title: "Linear",
            transport: "http",
            groups: ["exec"],
            url: "https://mcp.linear.app/mcp",
            headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
            tools: ["search_issues", "create_issue"],
          },
        }),
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("submits the description and icon when provided", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "linear");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Linear");
    await userEvent.type(screen.getByPlaceholderText("Track issues and pull requests."), "Track issues and pull requests.");
    await userEvent.selectOptions(screen.getByLabelText("Icon"), "chart");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://mcp.linear.app/mcp");
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    const body = bodyOf() as { entry: Record<string, unknown> };
    expect(body.entry).toEqual({
      title: "Linear",
      transport: "http",
      groups: [],
      url: "https://mcp.linear.app/mcp",
      description: "Track issues and pull requests.",
      icon: "chart",
    });
  });

  it("sends the stdio half of the fields and never a url alongside a command", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "notes");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Notes");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://leftover.example.com");
    await userEvent.click(screen.getByRole("radio", { name: "stdio" }));
    await userEvent.type(screen.getByPlaceholderText("npx"), "npx");
    await userEvent.type(screen.getByPlaceholderText(/-y/), "-y\n@example/notes-mcp");
    await userEvent.type(
      screen.getByPlaceholderText("EXAMPLE_TOKEN: ${EXAMPLE_TOKEN}"),
      "NOTES_TOKEN: ${{NOTES_TOKEN}",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    expect(bodyOf()).toEqual({
      verb: "upsert",
      slug: "notes",
      entry: {
        title: "Notes",
        transport: "stdio",
        groups: [],
        command: "npx",
        args: ["-y", "@example/notes-mcp"],
        env: { NOTES_TOKEN: "${NOTES_TOKEN}" },
      },
    });
  });

  it("omits an untouched optional rather than sending an empty object or list", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "bare");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Bare");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://bare.example.com/mcp");
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    const body = bodyOf() as { entry: Record<string, unknown> };
    expect(Object.keys(body.entry)).toEqual(["title", "transport", "groups", "url"]);
  });

  it("splits a header at the first colon, so a value may contain one", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "proxy");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Proxy");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://proxy.example.com/mcp");
    await userEvent.type(
      screen.getByPlaceholderText("Authorization: Bearer ${EXAMPLE_TOKEN}"),
      "X-Upstream: https://origin.example.com/v1\n\nX-Trace: on",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    const body = bodyOf() as { entry: { headers: Record<string, string> } };
    expect(body.entry.headers).toEqual({
      "X-Upstream": "https://origin.example.com/v1",
      "X-Trace": "on",
    });
  });

  it("edits an existing connector under its own slug, which stays read only", async () => {
    renderAdmin({ entries: [HTTP_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByPlaceholderText("linear")).toHaveAttribute("readonly");
    await userEvent.clear(screen.getByPlaceholderText("Linear"));
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Linear Issues");
    await userEvent.click(screen.getByRole("button", { name: "Save connector" }));

    expect(bodyOf()).toEqual({
      verb: "upsert",
      slug: "linear",
      entry: {
        title: "Linear Issues",
        transport: "http",
        groups: ["exec"],
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
        tools: ["search_issues"],
      },
    });
  });
});

describe("ConnectorsAdmin stale groups", () => {
  const STALE_ROW: ConnectorRow = { ...HTTP_ROW, groups: ["legacy", "exec"] };

  it("drops a group that no longer exists, so the payload matches the checkboxes", async () => {
    renderAdmin({ entries: [STALE_ROW], groupNames: ["exec", "research"] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    // No checkbox can express "legacy", so nothing may submit it either.
    expect(screen.queryByRole("checkbox", { name: "legacy" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "exec" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save connector" }));

    const body = bodyOf() as { entry: { groups: string[] } };
    expect(body.entry.groups).toEqual(["exec"]);
  });

  it("names the dropped group rather than removing it silently", async () => {
    renderAdmin({ entries: [STALE_ROW], groupNames: ["exec", "research"] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("stale-groups")).toHaveTextContent("legacy");
  });
});

describe("ConnectorsAdmin remove", () => {
  it("posts the remove verb once the deletion is confirmed", async () => {
    renderAdmin({ entries: [HTTP_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Delete linear" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/connectors",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verb: "remove", slug: "linear" }),
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("posts nothing when the confirmation is declined", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderAdmin({ entries: [HTTP_ROW] });
    (fetch as unknown as { mockClear: () => void }).mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Delete linear" }));

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("ConnectorsAdmin connector requests", () => {
  const REQUEST_A = { id: "req-a", requesterEmail: "alice@example.com", text: "Add Notion", createdAt: "2026-08-01T00:00:00.000Z" };
  const REQUEST_B = { id: "req-b", requesterEmail: "bob@example.com", text: "Add Jira", createdAt: "2026-08-02T00:00:00.000Z" };

  function stubRequestsFetch(requests: Array<typeof REQUEST_A>) {
    return vi.fn((url: string, init?: { method?: string }) => {
      if (url === "/api/admin/connectors/requests" && init?.method === "PATCH") return Promise.resolve({ ok: true, json: async () => ({ resolved: true }) });
      if (url === "/api/admin/connectors/requests") return Promise.resolve({ ok: true, json: async () => ({ requests, openCount: requests.length }) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
  }

  it("renders open requests with a count badge", async () => {
    vi.stubGlobal("fetch", stubRequestsFetch([REQUEST_A, REQUEST_B]));
    renderAdmin();
    expect(await screen.findByText("Add Notion")).toBeInTheDocument();
    expect(screen.getByText("Add Jira")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("resolves a request and removes its row on success", async () => {
    vi.stubGlobal("fetch", stubRequestsFetch([REQUEST_A]));
    renderAdmin();
    await screen.findByText("Add Notion");
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(fetch).toHaveBeenCalledWith("/api/admin/connectors/requests", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "req-a" }) }));
    await waitFor(() => expect(screen.queryByText("Add Notion")).toBeNull());
  });

  it("renders no requests section when there are none open", async () => {
    vi.stubGlobal("fetch", stubRequestsFetch([]));
    renderAdmin();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/connectors/requests"));
    expect(screen.queryByText("Connector requests")).toBeNull();
  });
});

describe("ConnectorsAdmin connection test", () => {
  it("reports the tool count from a successful probe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, toolCount: 7 }) }));
    renderAdmin({ entries: [HTTP_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/connectors/test",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: "linear" }) }),
    );
    expect(await screen.findByText("Connected, 7 tool(s) offered.")).toBeInTheDocument();
  });

  it("shows the probe's own reason when the handshake fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "fetch failed: https://mcp.linear.app/mcp" }),
    }));
    renderAdmin({ entries: [HTTP_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/fetch failed/)).toBeInTheDocument();
  });
});
