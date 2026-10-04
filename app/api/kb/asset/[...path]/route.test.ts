import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args),
}));

let root: string;
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => root }));

const { GET } = await import("./route");

function call(segments: string[]): Promise<Response> {
  const url = `http://x/api/kb/asset/${segments.map(encodeURIComponent).join("/")}`;
  return GET(new Request(url), { params: Promise.resolve({ path: segments }) });
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-asset-"));
  const abs = path.join(root, "assets/charts/diagram.png");
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, PNG_BYTES);
  // A markdown doc stored under assets/ must NOT be served here (it is a
  // document, rendered as HTML by the page).
  mkdirSync(path.join(root, "assets/handoff"), { recursive: true });
  writeFileSync(path.join(root, "assets/handoff/report.md"), "# a real doc");
  resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });
});
afterEach(() => {
  resolveIdentityMock.mockReset();
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/kb/asset/[...path]", () => {
  it("serves an image as its real bytes with the right Content-Type", async () => {
    const res = await call(["assets", "charts", "diagram.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("404s an unauthenticated request (fail closed, indistinguishable from missing)", async () => {
    resolveIdentityMock.mockResolvedValue(null);
    const res = await call(["assets", "charts", "diagram.png"]);
    expect(res.status).toBe(404);
  });

  it("404s a missing asset", async () => {
    expect((await call(["assets", "charts", "nope.png"])).status).toBe(404);
  });

  it("404s a directory", async () => {
    expect((await call(["assets", "charts"])).status).toBe(404);
  });

  it("404s a markdown file (docs are served as HTML by the page, never here)", async () => {
    expect((await call(["assets", "handoff", "report.md"])).status).toBe(404);
  });
});
