import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc, insertLink, addComment, removeLink } from "@/lib/db/shared-docs";
import { resolveExternalView, EXTERNAL_RATE_LIMIT } from "./external-view";
import { resetRateLimits } from "./rate-limit";

let db: DatabaseType;
const NOW = new Date("2026-07-11T00:00:00.000Z");

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.EXTERNAL_SHARE_ENABLED = "1";
  resetRateLimits();
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Partner brief", ownerEmail: "alice@example.com", body: "# secret plan" }, NOW.toISOString());
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.EXTERNAL_SHARE_ENABLED;
});

describe("resolveExternalView", () => {
  it("is unavailable when EXTERNAL_SHARE_ENABLED is off", () => {
    delete process.env.EXTERNAL_SHARE_ENABLED;
    insertLink(db, { token: "t", docId: "d1", access: "view", expiresAt: null }, NOW.toISOString());
    expect(resolveExternalView(db, "t", "ip1", NOW).status).toBe("unavailable");
  });

  it("renders a valid view token without a session, no comments", () => {
    insertLink(db, { token: "t", docId: "d1", access: "view", expiresAt: "2026-08-01T00:00:00.000Z" }, NOW.toISOString());
    addComment(db, { id: "c1", docId: "d1", authorEmail: "x@x.com", body: "hi", anchor: null }, NOW.toISOString());
    const view = resolveExternalView(db, "t", "ip1", NOW);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.title).toBe("Partner brief");
    expect(view.body).toBe("# secret plan");
    expect(view.access).toBe("view");
    expect(view.comments).toEqual([]); // a view link never sees the thread
  });

  it("carries the body's format, so the page knows which renderer to use", () => {
    insertSharedDoc(
      db,
      { id: "h1", title: "Designed page", ownerEmail: "alice@example.com", body: "<h1>Designed</h1>", format: "html" },
      NOW.toISOString(),
    );
    insertLink(db, { token: "th", docId: "h1", access: "view", expiresAt: null }, NOW.toISOString());
    const view = resolveExternalView(db, "th", "ip1", NOW);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.format).toBe("html");

    insertLink(db, { token: "tm", docId: "d1", access: "view", expiresAt: null }, NOW.toISOString());
    const md = resolveExternalView(db, "tm", "ip1", NOW);
    expect(md.status === "ok" && md.format).toBe("md");
  });

  it("a comment token may see the comment thread", () => {
    insertLink(db, { token: "t", docId: "d1", access: "comment", expiresAt: null }, NOW.toISOString());
    addComment(db, { id: "c1", docId: "d1", authorEmail: "x@x.com", body: "hi", anchor: null }, NOW.toISOString());
    const view = resolveExternalView(db, "t", "ip1", NOW);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.access).toBe("comment");
    expect(view.comments.map((c) => c.body)).toEqual(["hi"]);
  });

  it("an unknown, revoked, or expired token all resolve to not-found identically", () => {
    insertLink(db, { token: "expired", docId: "d1", access: "view", expiresAt: "2026-07-10T00:00:00.000Z" }, "2026-07-09T00:00:00.000Z");
    expect(resolveExternalView(db, "unknown", "ip1", NOW).status).toBe("not-found");
    expect(resolveExternalView(db, "expired", "ip2", NOW).status).toBe("not-found");
  });

  it("a REVOKED token, a separately EXPIRED token, and an unknown token are byte-identical (finding 7)", () => {
    // A live token that we then revoke.
    insertLink(db, { token: "revoked", docId: "d1", access: "view", expiresAt: null }, NOW.toISOString());
    expect(resolveExternalView(db, "revoked", "ip1", NOW).status).toBe("ok"); // live before revoke
    removeLink(db, "d1", "revoked");
    // A separately expired token.
    insertLink(db, { token: "expired", docId: "d1", access: "view", expiresAt: "2026-07-10T00:00:00.000Z" }, "2026-07-09T00:00:00.000Z");

    const revoked = resolveExternalView(db, "revoked", "ip2", NOW);
    const expired = resolveExternalView(db, "expired", "ip3", NOW);
    const unknown = resolveExternalView(db, "never-existed", "ip4", NOW);
    // All three are the same object shape, so the page maps them to the same 404.
    expect(revoked).toEqual({ status: "not-found" });
    expect(expired).toEqual(revoked);
    expect(unknown).toEqual(revoked);
    // And no doc id or owner leaks into any of them.
    expect(JSON.stringify([revoked, expired, unknown])).not.toContain("d1");
  });

  it("rate-limits a client BEFORE looking at the token (no brute-force oracle)", () => {
    // Exhaust the window with invalid tokens: still throttles, revealing nothing.
    for (let i = 0; i < EXTERNAL_RATE_LIMIT; i++) {
      expect(resolveExternalView(db, "bad", "attacker", NOW).status).toBe("not-found");
    }
    // The next hit, even with a VALID token, is throttled, not resolved.
    insertLink(db, { token: "good", docId: "d1", access: "view", expiresAt: null }, NOW.toISOString());
    expect(resolveExternalView(db, "good", "attacker", NOW).status).toBe("rate-limited");
    // A different client is unaffected.
    expect(resolveExternalView(db, "good", "other", NOW).status).toBe("ok");
  });
});
