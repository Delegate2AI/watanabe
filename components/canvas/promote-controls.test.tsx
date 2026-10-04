// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromoteControls } from "./promote-controls";
import type { CanvasDocData } from "./use-chat-doc";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function base(promotions: CanvasDocData["promotions"] = []): CanvasDocData {
  return {
    doc: { id: "d1", title: "Memo", currentVersion: 2, updatedAt: "" },
    versions: [],
    promotions,
    flags: { artifactsEnabled: true, sharedDocsEnabled: true },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("PromoteControls", () => {
  it("promotes to a target, refreshes, and navigates to the target surface", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ targetId: "art1", targetType: "artifact" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<PromoteControls docId="d1" data={base()} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Promote to Artifact" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat-docs/d1/promote",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onChanged).toHaveBeenCalled();
    // Spec 29: opening the target's management surface (spec-27 publish sheet).
    expect(push).toHaveBeenCalledWith("/artifacts/art1");
  });

  it("warns on divergence then applies on confirm", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "conflict", detail: "diverged" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ newTargetVersion: 5 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    const data = base([
      {
        targetType: "artifact",
        targetId: "art1",
        promotedVersion: 1,
        targetVersionAtPromote: 1,
        targetCurrentVersion: 4,
        classification: { status: "diverged", warn: true, projectedTargetVersion: 5 },
      },
    ]);
    // Only artifact promoted; keep shared_doc off so its Promote button is absent.
    data.flags.sharedDocsEnabled = false;
    render(<PromoteControls docId="d1" data={data} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "Update Artifact" }));
    // The divergence confirm names the versions.
    expect(await screen.findByText(/edited since you promoted it/)).toBeInTheDocument();
    expect(screen.getByText(/now at v4, you promoted v1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update anyway" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/chat-docs/d1/update-target",
      expect.objectContaining({ body: JSON.stringify({ target: "artifact", confirm: true }) }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("hides all targets when both flags are off", () => {
    const data = base();
    data.flags = { artifactsEnabled: false, sharedDocsEnabled: false };
    render(<PromoteControls docId="d1" data={data} onChanged={() => {}} />);
    expect(screen.getByText(/turned off/)).toBeInTheDocument();
  });
});
