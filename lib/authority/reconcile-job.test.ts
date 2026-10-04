import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { recordStart } from "@/lib/jobs/state";
import { runReconcile } from "./reconcile-job";

type Db = ReturnType<typeof openDb>;
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  delete process.env.AUTHORITY_ENABLED;
});

afterEach(() => {
  db.close();
  delete process.env.AUTHORITY_ENABLED;
});

describe("runReconcile", () => {
  it("is a no-op when AUTHORITY_ENABLED is off", async () => {
    const result = await runReconcile(db);
    expect(result).toEqual({ detail: "authority disabled; reconcile skipped" });
  });

  it("emits a health summary when AUTHORITY_ENABLED is on", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    // A processing run leaves one job "stuck", which the summary should count.
    recordStart(db, "meetings-poll");

    const result = await runReconcile(db);
    expect(result).toEqual({ detail: "reconcile ok: 1 stuck job(s)" });
  });

  it("reports zero stuck jobs on a clean database", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    const result = await runReconcile(db);
    expect(result).toEqual({ detail: "reconcile ok: 0 stuck job(s)" });
  });
});
