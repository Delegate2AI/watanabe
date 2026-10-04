// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityProvider } from "@/components/identity-provider";
import { FLAG_REGISTRY } from "@/lib/config/flag-registry";
import type { AccessHistoryEntry } from "@/lib/authority/access";
import type { Person } from "@/lib/people/types";
import { AccessAdmin } from "./access-admin";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

type FlagStates = Record<string, { enabled: boolean; envEnabled: boolean }>;

function baseFlagStates(): FlagStates {
  const states = Object.fromEntries(
    FLAG_REGISTRY.map(({ envVar }) => [envVar, { enabled: false, envEnabled: false }]),
  ) as FlagStates;
  states.MEMORY_ENABLED = { enabled: false, envEnabled: true };
  return states;
}

const flagStates = baseFlagStates();

function renderAdmin(options: {
  flags?: Record<string, boolean>;
  flagStates?: FlagStates;
  groups?: Record<string, string[]>;
  history?: AccessHistoryEntry[];
  people?: Record<string, Person>;
} = {}) {
  return render(
    <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"] }}>
      <AccessAdmin
        access={{
          groups: options.groups ?? { admins: ["admin@example.com"] },
          roles: { admin: ["admin@example.com"] },
          flags: options.flags ?? { MEMORY_ENABLED: false },
          default: "viewer",
        }}
        history={options.history ?? []}
        groupsEnabled
        rolesEnabled
        flagStates={options.flagStates ?? flagStates}
        people={options.people}
      />
    </IdentityProvider>,
  );
}

describe("AccessAdmin flags tab", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ warnings: [] }),
    }));
  });

  it("renders every registry flag with resolved, environment, and override state", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));

    expect(screen.getAllByRole("switch")).toHaveLength(FLAG_REGISTRY.length);
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("env: on, override: off")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Toggle Memory" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("posts the inverse resolved value when a flag is toggled", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));
    await userEvent.click(screen.getByRole("switch", { name: "Toggle Memory" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verb: "setFlag", name: "MEMORY_ENABLED", value: true }),
      }),
    );
  });

  it("holds a restart-effect flag in a pending state while the deployment disagrees", async () => {
    const states = baseFlagStates();
    states.KB_WRITE_ENABLED = { enabled: true, envEnabled: true };
    states.PACKAGES_ENABLED = { enabled: true, envEnabled: false };
    renderAdmin({ flagStates: states, flags: { KB_WRITE_ENABLED: true, PACKAGES_ENABLED: true } });
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));

    expect(screen.getByTestId("pending-PACKAGES_ENABLED")).toHaveTextContent("Pending restart");
    expect(screen.getByText(/restart the deployment before this takes effect/i)).toBeInTheDocument();
    // A restart flag the deployment already agrees with is not pending.
    expect(screen.queryByTestId("pending-KB_WRITE_ENABLED")).toBeNull();
  });

  it("keeps the pending state after a toggle, because only a restart clears it", async () => {
    const states = baseFlagStates();
    states.KB_WRITE_ENABLED = { enabled: true, envEnabled: true };
    renderAdmin({ flagStates: states, flags: { KB_WRITE_ENABLED: true } });
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));

    expect(screen.queryByTestId("pending-PACKAGES_ENABLED")).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "Toggle Packages" }));

    expect(screen.getByTestId("pending-PACKAGES_ENABLED")).toBeInTheDocument();
  });

  it("disables a flag whose dependency is unmet and says which one", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));

    expect(screen.getByRole("switch", { name: "Toggle Packages" })).toBeDisabled();
    expect(screen.getByTestId("reason-PACKAGES_ENABLED")).toHaveTextContent(
      "Requires Knowledge base writes",
    );
    await userEvent.click(screen.getByRole("switch", { name: "Toggle Packages" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves a flag with an unmet dependency switchable off, so it cannot be trapped on", async () => {
    const states = baseFlagStates();
    states.PACKAGES_ENABLED = { enabled: true, envEnabled: true };
    renderAdmin({ flagStates: states, flags: { PACKAGES_ENABLED: true } });
    await userEvent.click(screen.getByRole("tab", { name: "flags" }));

    expect(screen.getByRole("switch", { name: "Toggle Packages" })).toBeEnabled();
    expect(screen.queryByTestId("reason-PACKAGES_ENABLED")).toBeNull();
  });
});

describe("AccessAdmin history tab", () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  it("renders the subject, the actor as one name, and a relative timestamp", async () => {
    const { container } = renderAdmin({
      history: [{
        sha: "abc123",
        author: "maria.chen@example.com",
        email: "maria.chen@example.com",
        at: "2026-07-20T09:00:00.000Z",
        summary: "chore(access): set flag packages=on",
      }],
      people: {
        "maria.chen@example.com": {
          email: "maria.chen@example.com",
          name: "Maria Chen",
          initials: "MC",
          isSelf: false,
        },
      },
    });
    await userEvent.click(screen.getByRole("tab", { name: "history" }));

    expect(screen.getByText("chore(access): set flag packages=on")).toBeInTheDocument();
    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
    // The old row printed "email (email)". One name, no parenthesised repeat.
    expect(container.textContent).not.toContain("maria.chen@example.com (maria.chen@example.com)");
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-07-20T09:00:00.000Z");
    expect(time?.getAttribute("title")).toContain("20 Jul 2026");
  });
});

describe("AccessAdmin groups tab", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ warnings: [] }),
    }));
  });

  it("refreshes the page after a successful change and drops the manual-refresh copy", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "groups" }));
    await userEvent.type(screen.getByPlaceholderText("New group"), "Finance");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Access updated.");
    expect(screen.queryByText(/refresh to view/i)).not.toBeInTheDocument();
  });

  it("slugifies a group name before creating it", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "groups" }));
    await userEvent.type(screen.getByPlaceholderText("New group"), "Sales & Marketing");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verb: "createGroup", group: "sales-marketing" }),
      }),
    );
  });

  it("does not submit when the name has no slug characters", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("tab", { name: "groups" }));
    await userEvent.type(screen.getByPlaceholderText("New group"), "!!!");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/letters, numbers, or hyphens/i)).toBeInTheDocument();
  });

  it("adds a member from the group itself, without a trip to the members tab", async () => {
    renderAdmin({ groups: { admins: ["admin@example.com"], research: [] } });
    await userEvent.click(screen.getByRole("tab", { name: "groups" }));

    const addButtons = screen.getAllByRole("button", { name: "Add member" });
    expect(addButtons).toHaveLength(2);
    await userEvent.click(addButtons[1]);
    await userEvent.type(screen.getByLabelText("Email to add to research"), "maria.chen@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          verb: "addToGroup",
          group: "research",
          email: "maria.chen@example.com",
        }),
      }),
    );
  });
});
