// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityCluster } from "./identity-cluster";
import { IdentityProvider } from "@/components/identity-provider";
import { resolveStubIdentity } from "@/lib/identity/stub";

function renderCluster(activityEnabled?: boolean) {
  return render(
    <IdentityProvider identity={resolveStubIdentity()}>
      <IdentityCluster activityEnabled={activityEnabled} />
    </IdentityProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdentityCluster", () => {
  it("shows the clearance set, the name, and the avatar initial", () => {
    renderCluster();
    expect(screen.getByText("All-hands · Exec")).toBeInTheDocument();
    // name appears in the avatar pill (and the dropdown label)
    expect(screen.getAllByText("Nick").length).toBeGreaterThan(0);
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("renders help and settings controls, no bottom-left account block", () => {
    renderCluster();
    expect(
      screen.getByRole("button", { name: /help/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /settings/i }),
    ).toBeInTheDocument();
  });

  it("renders no activity bell when ACTIVITY_ENABLED is off (default)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCluster();
    expect(screen.queryByRole("button", { name: /activity/i })).toBeNull();
    // Byte-identical to today: the disabled bell makes no request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the activity bell when the flag is on", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ tasks: [], meetings: [], sharedDocs: [], taskComments: [], unreadCount: 0 })),
      ),
    );
    renderCluster(true);
    expect(screen.getByRole("button", { name: /activity/i })).toBeInTheDocument();
  });
});
