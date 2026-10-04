// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectReferences } from "./project-references";
import type { ResolvedReference } from "@/lib/db/project-references";

const notifySuccess = vi.fn();
const notifyFailure = vi.fn();
vi.mock("@/lib/ui/toast", () => ({
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyFailure: (...args: unknown[]) => notifyFailure(...args),
}));

const fetchMock = vi.fn();

const REFERENCE: ResolvedReference = {
  id: "r1",
  projectId: "p1",
  kind: "shared_doc",
  targetId: "d1",
  addedBy: "alice@example.com",
  createdAt: "2026-07-23T00:00:00Z",
  title: "Launch checklist",
  href: "/docs/d1",
};

beforeEach(() => {
  notifySuccess.mockReset();
  notifyFailure.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProjectReferences", () => {
  it("links an attached reference to where the target actually lives", () => {
    render(<ProjectReferences projectId="p1" initialReferences={[REFERENCE]} initialCandidates={[]} />);
    expect(screen.getByRole("link", { name: "Launch checklist" })).toHaveAttribute("href", "/docs/d1");
  });

  it("says plainly when nothing is referenced", () => {
    render(<ProjectReferences projectId="p1" initialReferences={[]} initialCandidates={[]} />);
    expect(screen.getByText("Nothing referenced yet.")).toBeTruthy();
  });

  it("attaches a candidate by reference and drops it from the picker", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ references: [REFERENCE] }) });
    render(
      <ProjectReferences
        projectId="p1"
        initialReferences={[]}
        initialCandidates={[{ kind: "shared_doc", targetId: "d1", title: "Launch checklist" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /attach existing/i }));
    await userEvent.click(screen.getByRole("button", { name: /Launch checklist/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/references",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "shared_doc", targetId: "d1" }),
      }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Attached "Launch checklist".'));
    expect(await screen.findByRole("link", { name: "Launch checklist" })).toBeTruthy();
  });

  it("detaches a reference and reports it", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<ProjectReferences projectId="p1" initialReferences={[REFERENCE]} initialCandidates={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Detach Launch checklist" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/references",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ referenceId: "r1" }) }),
    );
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Detached "Launch checklist".'));
    expect(screen.getByText("Nothing referenced yet.")).toBeTruthy();
  });

  it("finds a KB note by search and attaches it by path", async () => {
    const kbReference: ResolvedReference = {
      ...REFERENCE,
      id: "r2",
      kind: "kb",
      targetId: "03-product/trader-score.md",
      title: "Trader Score",
      href: "/kb/03-product/trader-score",
    };
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          kbCandidates: [{ kind: "kb", targetId: "03-product/trader-score.md", title: "Trader Score" }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ references: [kbReference] }) });

    render(<ProjectReferences projectId="p1" initialReferences={[]} initialCandidates={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /attach existing/i }));
    await userEvent.type(screen.getByRole("searchbox", { name: /search the knowledge base/i }), "score{enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/references?q=score"));
    await userEvent.click(await screen.findByRole("button", { name: /Trader Score/ }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/p1/references",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "kb", targetId: "03-product/trader-score.md" }),
      }),
    );
    expect(await screen.findByRole("link", { name: "Trader Score" })).toHaveAttribute(
      "href",
      "/kb/03-product/trader-score",
    );
  });

  it("says so when the knowledge base has no match for the search", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ kbCandidates: [] }) });
    render(<ProjectReferences projectId="p1" initialReferences={[]} initialCandidates={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /attach existing/i }));
    await userEvent.type(screen.getByRole("searchbox", { name: /search the knowledge base/i }), "zzz{enter}");

    expect(await screen.findByText("No knowledge-base notes match that.")).toBeTruthy();
  });

  it("reports an attach failure through the toast path", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { code: "not_found" } }) });
    render(
      <ProjectReferences
        projectId="p1"
        initialReferences={[]}
        initialCandidates={[{ kind: "artifact", targetId: "a1", title: "Pricing memo" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /attach existing/i }));
    await userEvent.click(screen.getByRole("button", { name: /Pricing memo/ }));
    await waitFor(() =>
      expect(notifyFailure).toHaveBeenCalledWith("That item no longer exists, or you cannot see it."),
    );
  });
});
