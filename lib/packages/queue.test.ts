import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `runPackageJob` is mocked so `bootPackages` (which always enqueues with the
 * real job, per its own signature, with no `run` override) can be observed
 * without pulling in the whole SDK-driving runner. The sequential/rejection
 * tests below pass an explicit spy `run` to `enqueuePackage` instead and
 * never touch this mock.
 */
const runPackageJobMock = vi.fn(async (id: string) => {
  void id;
});
vi.mock("./runner", () => ({
  runPackageJob: (id: string) => runPackageJobMock(id),
}));

const { enqueuePackage, bootPackages, __resetPackagesQueueForTests } = await import("./queue");
const { openDb } = await import("@/lib/db/client");
const { insertPackage, markProcessing, markSubmitted, markFailed, markNoChanges } = await import("@/lib/db/packages");

/** Flush the microtask queue (and any already-scheduled macrotask) so promise
 *  chains driven by `enqueuePackage` have had a chance to progress before an
 *  assertion runs. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetPackagesQueueForTests();
  runPackageJobMock.mockClear();
});

describe("enqueuePackage", () => {
  it("runs two jobs strictly sequentially: the second starts only after the first resolves", async () => {
    const events: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const run = vi.fn((id: string) => {
      events.push(`start:${id}`);
      const d = id === "a" ? d1 : d2;
      return d.promise.then(() => {
        events.push(`finish:${id}`);
      });
    });

    enqueuePackage("a", run);
    enqueuePackage("b", run);
    await flush();
    expect(events).toEqual(["start:a"]);

    d1.resolve();
    await flush();
    expect(events).toEqual(["start:a", "finish:a", "start:b"]);

    d2.resolve();
    await flush();
    expect(events).toEqual(["start:a", "finish:a", "start:b", "finish:b"]);
  });

  it("a rejecting job does not poison the chain: a third job still runs", async () => {
    const events: string[] = [];
    const run = vi.fn((id: string) => {
      events.push(id);
      return id === "fail" ? Promise.reject(new Error("boom")) : Promise.resolve();
    });

    enqueuePackage("ok1", run);
    enqueuePackage("fail", run);
    enqueuePackage("ok2", run);
    await flush();
    await flush();

    expect(events).toEqual(["ok1", "fail", "ok2"]);
  });

  it("defaults to runPackageJob when no run fn is given", async () => {
    enqueuePackage("p1");
    await flush();
    expect(runPackageJobMock).toHaveBeenCalledWith("p1");
  });
});

describe("bootPackages", () => {
  it("requeues stuck processing rows and enqueues both those and pre-existing queued rows", async () => {
    const db = openDb(":memory:");
    insertPackage(db, { id: "p-queued", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p-processing", ownerEmail: "alice@x.com", name: "n2" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p-processing", "thread-1", "2026-07-01T00:01:00Z");

    bootPackages(db);
    await flush();

    const calledIds = runPackageJobMock.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(["p-processing", "p-queued"]);
  });

  it("leaves submitted/failed/no_changes packages alone", async () => {
    const db = openDb(":memory:");
    insertPackage(db, { id: "p-queued", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p-submitted", ownerEmail: "alice@x.com", name: "n2" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p-submitted", "thread-1", "2026-07-01T00:01:00Z");
    markSubmitted(db, "p-submitted", { mrUrl: "https://gitlab/mr/1", report: "r" }, "2026-07-01T00:02:00Z");
    insertPackage(db, { id: "p-failed", ownerEmail: "alice@x.com", name: "n3" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p-failed", "thread-2", "2026-07-01T00:01:00Z");
    markFailed(db, "p-failed", { error: "boom" }, "2026-07-01T00:02:00Z");
    insertPackage(db, { id: "p-no-changes", ownerEmail: "alice@x.com", name: "n4" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p-no-changes", "thread-3", "2026-07-01T00:01:00Z");
    markNoChanges(db, "p-no-changes", "nothing to do", "2026-07-01T00:02:00Z");

    bootPackages(db);
    await flush();

    const calledIds = runPackageJobMock.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(["p-queued"]);
  });
});
