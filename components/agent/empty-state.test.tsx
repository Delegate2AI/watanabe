// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { CapabilitiesState } from "@/lib/ui/capabilities";

const capabilitiesMock = vi.fn<() => CapabilitiesState>();
vi.mock("@/lib/ui/capabilities", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ui/capabilities")>();
  return { ...actual, useCapabilities: () => capabilitiesMock() };
});

const { EmptyState } = await import("./empty-state");

function state(shortFormContent: boolean | undefined): CapabilitiesState {
  return { kbWrite: true, dictation: true, shortFormContent, loading: false };
}

afterEach(() => {
  cleanup();
  capabilitiesMock.mockReset();
});

describe("the short-form content starter", () => {
  it("appears when this deployment can actually generate copy", async () => {
    capabilitiesMock.mockReturnValue(state(true));
    render(<EmptyState onPick={() => {}} />);
    await waitFor(() => expect(screen.getByText("Write a social post")).toBeTruthy());
  });

  it("is absent when the portal holds no content service key", () => {
    // A card offering copy generation on a deployment that cannot generate any
    // is worse than no card.
    capabilitiesMock.mockReturnValue(state(false));
    render(<EmptyState onPick={() => {}} />);
    expect(screen.queryByText("Write a social post")).toBeNull();
  });

  it("is absent while the capability probe is still unknown", () => {
    // Additive, so unknown means do not show: a card that appears and then
    // vanishes is a worse flicker than one that arrives a moment late.
    capabilitiesMock.mockReturnValue(state(undefined));
    render(<EmptyState onPick={() => {}} />);
    expect(screen.queryByText("Write a social post")).toBeNull();
  });

  it("leaves the other starters untouched either way", () => {
    capabilitiesMock.mockReturnValue(state(false));
    render(<EmptyState onPick={() => {}} />);
    expect(screen.getByText("What's in the knowledge base?")).toBeTruthy();
  });

  it("prefills the composer as a sentence opener rather than sending", async () => {
    capabilitiesMock.mockReturnValue(state(true));
    const onPick = vi.fn();
    render(<EmptyState onPick={onPick} />);
    const card = await screen.findByText("Write a social post");
    card.closest("button")!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].prompt).toBe("Draft three LinkedIn post variants about ");
  });
});
