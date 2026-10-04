// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
const resolveIdentityMock = vi.fn();
const canMock = vi.fn();
const connectorsEnabledMock = vi.fn();
const loadRegistryMock = vi.fn();
const loadAccessMock = vi.fn();

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args) }));
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));
vi.mock("@/lib/authority/access", () => ({ loadAccess: () => loadAccessMock() }));
vi.mock("@/lib/connectors/config", () => ({ isConnectorsEnabled: () => connectorsEnabledMock() }));
vi.mock("@/lib/connectors/registry", () => ({ loadConnectorRegistry: () => loadRegistryMock() }));

import type { ConnectorRow } from "@/components/admin/connectors-form";

const capturedEntries: ConnectorRow[][] = [];
vi.mock("@/components/admin/connectors-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/admin/connectors-admin")>();
  return {
    ...actual,
    ConnectorsAdmin: (props: { entries: ConnectorRow[]; groupNames: string[] }) => {
      capturedEntries.push(props.entries);
      return <actual.ConnectorsAdmin {...props} />;
    },
  };
});

import Page from "./page";

const HEALTHY = {
  slug: "linear",
  title: "Linear",
  transport: "http" as const,
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["exec"],
  tools: ["search_issues"],
};

beforeEach(() => {
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "admin@example.com" });
  canMock.mockReset().mockReturnValue(true);
  connectorsEnabledMock.mockReset().mockReturnValue(true);
  loadRegistryMock.mockReset().mockReturnValue({ entries: [HEALTHY], errors: [] });
  loadAccessMock.mockReset().mockReturnValue({ groups: { exec: ["admin@example.com"] } });
  notFoundMock.mockClear();
  capturedEntries.length = 0;
  delete process.env.LINEAR_TOKEN;
});

describe("ConnectorsAdminPage", () => {
  it("renders a registered connector with the presence of every variable it references", async () => {
    const { container } = render(await Page());

    expect(container.textContent).toContain("Connectors");
    expect(container.textContent).toContain("linear");
    expect(container.textContent).toContain("LINEAR_TOKEN");
    // Presence only, never the value: the badge says the variable is missing.
    expect(container.textContent).toContain("not set");
  });

  it("reports a referenced variable as set once the environment carries it", async () => {
    process.env.LINEAR_TOKEN = "secret-value";
    const { container } = render(await Page());

    expect(container.textContent).toContain("LINEAR_TOKEN");
    expect(container.textContent).not.toContain("secret-value");
  });

  it("never passes oauthClientSecret down to the client island", async () => {
    loadRegistryMock.mockReturnValue({
      entries: [{ ...HEALTHY, auth: "oauth", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }],
      errors: [],
    });
    render(await Page());

    expect(Object.keys(capturedEntries[0][0])).not.toContain("oauthClientSecret");
  });

  it("shows a rejected entry with the reason the loader gave", async () => {
    loadRegistryMock.mockReturnValue({ entries: [], errors: [{ slug: "broken", reason: "http/sse need url" }] });
    const { container } = render(await Page());

    expect(container.textContent).toContain("broken");
    expect(container.textContent).toContain("http/sse need url");
  });

  it("renders the loader's file-level error as a file problem, not a connector", async () => {
    loadRegistryMock.mockReturnValue({ entries: [], errors: [{ slug: "*", reason: "bad indentation" }] });
    const { container, queryByRole } = render(await Page());

    expect(container.textContent).toContain("access/connectors.yaml");
    expect(container.textContent).toContain("bad indentation");
    expect(queryByRole("button", { name: /delete \*/i })).toBeNull();
  });

  it("returns the identical 404 for a non-admin or a missing identity", async () => {
    canMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    resolveIdentityMock.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadRegistryMock).not.toHaveBeenCalled();
  });

  it("returns 404 with CONNECTORS_ENABLED off, so flag-off shows no admin surface", async () => {
    connectorsEnabledMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadRegistryMock).not.toHaveBeenCalled();
  });
});
