import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordDecision, listDecisions } from "./review-decisions";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => db.close());

describe("review decisions", () => {
  it("records who decided what, and on which paths", () => {
    recordDecision(db, {
      iid: 7,
      actorEmail: "boss@example.com",
      action: "approve",
      paths: ["docs/a.md", "docs/b.md"],
      selfApproval: true,
    });

    expect(listDecisions(db, 7)).toEqual([
      expect.objectContaining({
        iid: 7,
        actorEmail: "boss@example.com",
        action: "approve",
        paths: ["docs/a.md", "docs/b.md"],
        selfApproval: true,
      }),
    ]);
  });

  it("keeps both decisions when one merge request is acted on twice", () => {
    recordDecision(db, { iid: 7, actorEmail: "a@example.com", action: "reject", paths: [], selfApproval: false });
    recordDecision(db, { iid: 7, actorEmail: "b@example.com", action: "approve", paths: [], selfApproval: false });

    const decisions = listDecisions(db, 7);
    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.actorEmail)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("returns nothing for a merge request nobody has decided", () => {
    expect(listDecisions(db, 99)).toEqual([]);
  });

  it("keeps one merge request's decisions out of another's", () => {
    recordDecision(db, { iid: 7, actorEmail: "a@example.com", action: "approve", paths: [], selfApproval: false });
    recordDecision(db, { iid: 8, actorEmail: "a@example.com", action: "reject", paths: [], selfApproval: false });

    expect(listDecisions(db, 8).map((d) => d.action)).toEqual(["reject"]);
  });

  it("stamps a decision with an ISO timestamp", () => {
    recordDecision(db, { iid: 7, actorEmail: "a@example.com", action: "approve", paths: [], selfApproval: false });
    expect(listDecisions(db, 7)[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("reads a garbled paths value as an empty list rather than throwing", () => {
    recordDecision(db, { iid: 7, actorEmail: "a@example.com", action: "approve", paths: ["docs/a.md"], selfApproval: false });
    db.prepare(`UPDATE kb_review_decisions SET paths = 'not json' WHERE iid = 7`).run();

    expect(listDecisions(db, 7)[0].paths).toEqual([]);
  });

  it("drops a non-string entry from a paths list rather than handing it on", () => {
    recordDecision(db, { iid: 7, actorEmail: "a@example.com", action: "approve", paths: [], selfApproval: false });
    db.prepare(`UPDATE kb_review_decisions SET paths = '["docs/a.md", 3]' WHERE iid = 7`).run();

    expect(listDecisions(db, 7)[0].paths).toEqual(["docs/a.md"]);
  });

  it("refuses an action outside the two the queue can produce", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO kb_review_decisions (iid, actor_email, action, paths, self_approval, created_at)
           VALUES (7, 'a@example.com', 'merge', '[]', 0, '2026-08-18T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
  });
});
