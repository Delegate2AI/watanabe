// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityProvider, useIdentity } from "./identity-provider";
import { resolveStubIdentity } from "@/lib/identity/stub";

function Probe() {
  const id = useIdentity();
  return (
    <div>
      <span data-testid="name">{id.name}</span>
      <span data-testid="clearance">{id.clearance.join(",")}</span>
    </div>
  );
}

describe("IdentityProvider", () => {
  it("flows the provided identity to consumers", () => {
    render(
      <IdentityProvider
        identity={{ email: "a@b.co", name: "Ada", initials: "A", clearance: ["All-hands"] }}
      >
        <Probe />
      </IdentityProvider>,
    );
    expect(screen.getByTestId("name")).toHaveTextContent("Ada");
    expect(screen.getByTestId("clearance")).toHaveTextContent("All-hands");
  });

  it("flows the stub identity end to end", () => {
    render(
      <IdentityProvider identity={resolveStubIdentity()}>
        <Probe />
      </IdentityProvider>,
    );
    expect(screen.getByTestId("name")).toHaveTextContent("Nick");
    expect(screen.getByTestId("clearance")).toHaveTextContent("All-hands,Exec");
  });

  it("throws when used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within an IdentityProvider/);
    spy.mockRestore();
  });
});
