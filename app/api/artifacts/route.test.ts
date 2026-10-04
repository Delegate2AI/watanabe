import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST, GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { getArtifactForOwner, listArtifactsForOwner, getVersions, latestBody } = await import("@/lib/db/artifacts");
const { recordThread } = await import("@/lib/db/threads");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function post(body: unknown): Request {
  return new Request("http://t/api/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});

afterEach(() => {
  delete process.env.ARTIFACTS_ENABLED;
});

describe("POST /api/artifacts (capture)", () => {
  it("is a 404 empty surface when the flag is off", async () => {
    const res = await POST(post({ title: "T", body: "b", sourceThreadId: "t1" }));
    expect(res.status).toBe(404);
    expect(listArtifactsForOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("creates a draft v1 linked to the source thread when enabled and owned", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    recordThread(db, "t1", ALICE.email, "chat"); // Alice owns t1
    const res = await POST(post({ title: "Risk draft", body: "# hi", sourceThreadId: "t1" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const a = getArtifactForOwner(db, id, ALICE.email);
    expect(a?.status).toBe("draft");
    expect(a?.title).toBe("Risk draft");
    expect(a?.sourceThreadId).toBe("t1");
    expect(a?.ownerEmail).toBe(ALICE.email);
    expect(latestBody(db, id, ALICE.email)).toBe("# hi");
    expect(getVersions(db, id, ALICE.email)).toHaveLength(1);
  });

  it("creates a draft from a KB note with its body, target path, and visibility intact", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const res = await POST(post({
      title: "Risk Tier Model",
      body: "# Risk Tier Model\n\nCanonical body.",
      targetPath: "03-product/risk-tiers.md",
      targetVisibility: ["exec"],
    }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const artifact = getArtifactForOwner(db, id, ALICE.email);
    expect(artifact?.status).toBe("draft");
    expect(artifact?.targetPath).toBe("03-product/risk-tiers.md");
    expect(artifact?.targetVisibility).toEqual(["exec"]);
    expect(latestBody(db, id, ALICE.email)).toBe("# Risk Tier Model\n\nCanonical body.");
  });

  it("404s a capture that names a thread the caller does not own (foreign)", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    recordThread(db, "t1", BOB.email, "bob's chat"); // t1 belongs to Bob
    const res = await POST(post({ title: "T", body: "b", sourceThreadId: "t1" }));
    expect(res.status).toBe(404);
    expect(listArtifactsForOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("404s a capture naming an unknown thread IDENTICALLY (no oracle)", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const res = await POST(post({ title: "T", body: "b", sourceThreadId: "ghost" }));
    expect(res.status).toBe(404);
    expect(listArtifactsForOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("rejects an empty body with a 400", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const res = await POST(post({ title: "T", body: "   " }));
    expect(res.status).toBe(400);
  });

  // "Save as artifact" sends no title, so the first line of the answer becomes
  // one. It is prose, not a heading, so it arrives full of inline markdown and
  // used to be stored verbatim: the artifacts grid showed literal asterisks.
  it("derives a readable title from the body, without the markdown", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const res = await POST(post({ body: "The glossary defines **Depth** as:\n\n> a quote" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    // The lead-in colon goes, the words stay: this strips markup, it does not
    // rewrite the author's prose into a shorter title.
    expect(getArtifactForOwner(db, id, ALICE.email)?.title).toBe("The glossary defines Depth as");
  });

  it("keeps stripping markdown across the other inline forms", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const cases: [string, string][] = [
      ["## Risk Tier Model", "Risk Tier Model"],
      ["A note on `depth` and _projection_", "A note on depth and projection"],
      ["See [the roadmap](/kb/01-strategy/roadmap) first", "See the roadmap first"],
      ["***Emphatic***   spacing:", "Emphatic spacing"],
      ["- a bullet first line", "a bullet first line"],
    ];
    for (const [body, title] of cases) {
      const res = await POST(post({ body }));
      const { id } = (await res.json()) as { id: string };
      expect(getArtifactForOwner(db, id, ALICE.email)?.title).toBe(title);
    }
  });

  // Both shapes below were observed in the real knowledge base: an answer whose
  // opening line is a whole prose sentence became a 100-character "title" and,
  // through the path suggestion, a matching unreadable filename.
  it("prefers the body's own heading over its opening prose line", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const body = "The short version, grounded in 00-overview/executive-summary.md:\n\n# Trader Score tiers\n\nBody.";
    const res = await POST(post({ body }));
    const { id } = (await res.json()) as { id: string };
    expect(getArtifactForOwner(db, id, ALICE.email)?.title).toBe("Trader Score tiers");
  });

  it("shortens a headingless prose opener on a word boundary", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const body = "I'll orient myself in the knowledge base first, then we can shape the document together properly.";
    const res = await POST(post({ body }));
    const { id } = (await res.json()) as { id: string };
    const title = getArtifactForOwner(db, id, ALICE.email)!.title;
    expect(title.length).toBeLessThanOrEqual(72);
    // Cut between words, never mid-word, and with no dangling punctuation.
    expect(body.startsWith(title)).toBe(true);
    expect(title).not.toMatch(/[\s,.:;]$/);
  });

  it("still falls back when a body has no usable text", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    const res = await POST(post({ body: "***" }));
    const { id } = (await res.json()) as { id: string };
    expect(getArtifactForOwner(db, id, ALICE.email)?.title).toBe("Untitled artifact");
  });

  it("401 when there is no identity", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no id" }, { status: 401 }) });
    const res = await POST(post({ title: "T", body: "b" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/artifacts (list)", () => {
  it("lists only the caller's artifacts", async () => {
    process.env.ARTIFACTS_ENABLED = "1";
    await POST(post({ title: "Mine", body: "b" }));
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    await POST(post({ title: "Bob's", body: "b" }));
    requireIdentityMock.mockResolvedValue({ identity: ALICE });
    const res = await GET(new Request("http://t/api/artifacts"));
    expect(res.status).toBe(200);
    const { artifacts } = (await res.json()) as { artifacts: Array<{ title: string }> };
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Mine");
  });

  it("empty list (200) when the flag is off", async () => {
    const res = await GET(new Request("http://t/api/artifacts"));
    expect(res.status).toBe(200);
    const { artifacts } = (await res.json()) as { artifacts: unknown[] };
    expect(artifacts).toEqual([]);
  });
});
