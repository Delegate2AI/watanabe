// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClearanceBadge } from "./clearance-badge";
import { IdentityProvider } from "@/components/identity-provider";

function withIdentity(clearance: string[]) {
  return render(
    <IdentityProvider
      identity={{ email: "n@x.co", name: "Nick", initials: "N", clearance }}
    >
      <ClearanceBadge />
    </IdentityProvider>,
  );
}

describe("ClearanceBadge", () => {
  it("renders the clearance set from the identity context, joined", () => {
    withIdentity(["All-hands", "Exec"]);
    expect(screen.getByText("All-hands · Exec")).toBeInTheDocument();
    expect(screen.getByText(/Cleared:/)).toBeInTheDocument();
  });

  it("reflects a different clearance set", () => {
    withIdentity(["All-hands"]);
    expect(screen.getByText("All-hands")).toBeInTheDocument();
  });

  it("says 'everything' for an admin (see-all), instead of an exhaustive list that lies", () => {
    withIdentity(["all-hands", "admins", "engineering", "exec"]);
    expect(screen.getByText("everything")).toBeInTheDocument();
    expect(screen.queryByText("all-hands · admins · engineering · exec")).toBeNull();
  });
});
