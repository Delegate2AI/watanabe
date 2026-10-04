// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Boxes } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";

const isArtifactsEnabledMock = vi.fn();
vi.mock("@/lib/artifacts/config", () => ({
  isArtifactsEnabled: () => isArtifactsEnabledMock(),
}));

// The on-branch touches these; the off-branch must never reach them.
const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const listArtifactsForOwnerMock = vi.fn(() => []);
vi.mock("@/lib/db/artifacts", () => ({
  listArtifactsForOwner: () => listArtifactsForOwnerMock(),
}));

const Page = (await import("./page")).default;

beforeEach(() => {
  isArtifactsEnabledMock.mockReset();
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com" });
  listArtifactsForOwnerMock.mockClear();
});

describe("ArtifactsPage flag-off scaffold", () => {
  it("renders the byte-identical spec-18 RouteScaffold when the flag is off", async () => {
    isArtifactsEnabledMock.mockReturnValue(false);
    const element = await Page();
    const actual = renderToStaticMarkup(element);
    const expected = renderToStaticMarkup(
      <RouteScaffold
        icon={Boxes}
        eyebrow="Artifacts"
        title="Things you made with Watanabe"
        description="Documents and drafts the assistant produced. Publish one back to the knowledge base to share it with everyone cleared for it."
        spec="spec 27"
        flag="ARTIFACTS_ENABLED"
      />,
    );
    expect(actual).toBe(expected);
    // The off-branch must not read identity or the store at all.
    expect(resolveIdentityMock).not.toHaveBeenCalled();
    expect(listArtifactsForOwnerMock).not.toHaveBeenCalled();
  });

  it("renders the real grid (not the scaffold) when the flag is on", async () => {
    isArtifactsEnabledMock.mockReturnValue(true);
    const element = await Page();
    const { container } = render(element);
    expect(container.textContent).not.toContain("not switched on here");
    expect(resolveIdentityMock).toHaveBeenCalled();
  });
});
