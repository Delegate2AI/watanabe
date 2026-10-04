import { afterEach, describe, expect, it, vi } from "vitest";

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args),
}));
vi.mock("@/lib/repo", () => ({ vaultRootFor: (c: string[]) => `/vault/${c.join("+")}` }));

const getKbGraphMock = vi.fn();
vi.mock("@/lib/kb/graph-cache", () => ({
  getKbGraph: (...args: unknown[]) => getKbGraphMock(...args),
}));

const listKbAnchoredTasksMock = vi.fn();
vi.mock("@/lib/db/tasks", () => ({
  listKbAnchoredTasks: (...args: unknown[]) => listKbAnchoredTasksMock(...args),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const { GET } = await import("./route");

const GRAPH = { nodes: [{ id: "a/one", t: "One", g: "a", d: 0 }], edges: [], total: 1 };

afterEach(() => {
  resolveIdentityMock.mockReset();
  getKbGraphMock.mockReset();
  listKbAnchoredTasksMock.mockReset();
  delete process.env.KB_GRAPH_ENABLED;
  delete process.env.TASKS_ENABLED;
});

describe("GET /api/kb/graph", () => {
  it("401s an unauthenticated request", async () => {
    process.env.KB_GRAPH_ENABLED = "1";
    resolveIdentityMock.mockResolvedValue(null);

    const res = await GET(new Request("http://x/api/kb/graph"));

    expect(res.status).toBe(401);
    expect(getKbGraphMock).not.toHaveBeenCalled();
  });

  it("404s with the flag off, leaving no new reachable surface", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });

    const res = await GET(new Request("http://x/api/kb/graph"));

    expect(res.status).toBe(404);
    expect(getKbGraphMock).not.toHaveBeenCalled();
  });

  it("serves the graph for the requester's own clearance root", async () => {
    process.env.KB_GRAPH_ENABLED = "1";
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands", "exec"] });
    getKbGraphMock.mockReturnValue(GRAPH);

    const res = await GET(new Request("http://x/api/kb/graph"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GRAPH);
    // The root is derived from the caller's clearance, never from the request.
    expect(getKbGraphMock).toHaveBeenCalledWith("/vault/all-hands+exec");
    // Tasks subsystem off: the payload is byte-identical to before the overlay
    // existed, and the task query is never even made.
    expect(listKbAnchoredTasksMock).not.toHaveBeenCalled();
  });

  it("overlays the requester's anchored tasks whenever the tasks subsystem is on", async () => {
    process.env.KB_GRAPH_ENABLED = "1";
    process.env.TASKS_ENABLED = "1";
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });
    getKbGraphMock.mockReturnValue(GRAPH);
    listKbAnchoredTasksMock.mockReturnValue([
      { id: "task-1", title: "Do it", sourceNotePath: "docs/a/one.md" },
    ]);

    const res = await GET(new Request("http://x/api/kb/graph"));

    const body = await res.json();
    expect(body.nodes).toEqual([
      { id: "a/one", t: "One", g: "a", d: 0 },
      { id: "task-1", t: "Do it", g: "a", d: 1, k: "task" },
    ]);
    expect(body.edges).toEqual([[0, 1]]);
    // Notes only: the overlay never inflates the census the cap line reports.
    expect(body.total).toBe(1);
    // Filtered by the caller's own clearance, never by anything in the request.
    expect(listKbAnchoredTasksMock).toHaveBeenCalledWith({}, ["all-hands"]);
  });
});
