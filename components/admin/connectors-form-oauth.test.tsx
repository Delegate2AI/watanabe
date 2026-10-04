// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsAdmin } from "./connectors-admin";
import type { ConnectorRow } from "./connectors-form";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const OAUTH_ROW: ConnectorRow = {
  slug: "linear",
  status: "ok",
  title: "Linear",
  transport: "http",
  url: "https://mcp.linear.app/mcp",
  groups: ["exec"],
  auth: "oauth",
  oauthClientId: "the-client-id",
  authOrigins: ["https://auth.linear.app"],
  envVars: [],
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

describe("ConnectorsForm oauth toggle", () => {
  it("does not render the authorization toggle for a stdio connector", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));
    await userEvent.click(screen.getByRole("radio", { name: "stdio" }));

    expect(screen.queryByText("Authorization")).toBeNull();
  });

  it("hides the oauth fields until oauth is selected", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    expect(screen.queryByPlaceholderText("the-client-id")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "oauth" }));
    expect(screen.getByPlaceholderText("the-client-id")).toBeInTheDocument();
  });

  it("submits auth, oauthClientId, oauthClientSecret, and authOrigins when oauth is selected", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "linear");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Linear");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://mcp.linear.app/mcp");
    await userEvent.click(screen.getByRole("radio", { name: "oauth" }));
    await userEvent.type(screen.getByPlaceholderText("the-client-id"), "the-client-id");
    await userEvent.type(screen.getByPlaceholderText("${EXAMPLE_OAUTH_SECRET}"), "${{LINEAR_OAUTH_SECRET}");
    await userEvent.type(screen.getByPlaceholderText("https://auth.example.com"), "https://auth.linear.app");
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    const body = bodyOf() as { entry: Record<string, unknown> };
    expect(body.entry).toEqual({
      title: "Linear",
      transport: "http",
      groups: [],
      url: "https://mcp.linear.app/mcp",
      auth: "oauth",
      oauthClientId: "the-client-id",
      oauthClientSecret: "${LINEAR_OAUTH_SECRET}",
      authOrigins: ["https://auth.linear.app"],
    });
  });

  it("omits every oauth field when auth stays none", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Add a connector" }));

    await userEvent.type(screen.getByPlaceholderText("linear"), "linear");
    await userEvent.type(screen.getByPlaceholderText("Linear"), "Linear");
    await userEvent.type(screen.getByPlaceholderText("https://mcp.example.com/mcp"), "https://mcp.linear.app/mcp");
    await userEvent.click(screen.getByRole("button", { name: "Add connector" }));

    const body = bodyOf() as { entry: Record<string, unknown> };
    expect(Object.keys(body.entry)).toEqual(["title", "transport", "groups", "url"]);
  });

  it("edits an existing oauth connector, leaving the secret blank to re-enter", async () => {
    renderAdmin({ entries: [OAUTH_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByPlaceholderText("the-client-id")).toHaveValue("the-client-id");
    expect(screen.getByPlaceholderText("${EXAMPLE_OAUTH_SECRET}")).toHaveValue("");
    expect(screen.getByPlaceholderText("https://auth.example.com")).toHaveValue("https://auth.linear.app");
  });
});
