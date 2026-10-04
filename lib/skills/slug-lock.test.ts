import { describe, expect, it } from "vitest";
import { skillSlugLockDepth, withSkillSlugLock } from "./slug-lock";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

describe("withSkillSlugLock", () => {
  it("serializes work taken on the same slug", async () => {
    const order: string[] = [];
    const gate = deferred();

    const first = withSkillSlugLock("release-notes", async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
      return 1;
    });
    const second = withSkillSlugLock("release-notes", async () => {
      order.push("second-start");
      return 2;
    });

    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("keys the lock by the trimmed lower-cased slug", async () => {
    const order: string[] = [];
    const gate = deferred();

    const first = withSkillSlugLock("release-notes", async () => {
      await gate.promise;
      order.push("first");
    });
    const second = withSkillSlugLock(" Release-Notes ", async () => {
      order.push("second");
    });

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("lets different slugs run concurrently", async () => {
    const gate = deferred();
    const order: string[] = [];

    const blocked = withSkillSlugLock("one", async () => {
      await gate.promise;
      order.push("one");
    });
    await withSkillSlugLock("two", async () => {
      order.push("two");
    });

    gate.resolve();
    await blocked;
    expect(order).toEqual(["two", "one"]);
  });

  it("releases the slug when the held work rejects, and leaves no entry behind", async () => {
    await expect(
      withSkillSlugLock("release-notes", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(withSkillSlugLock("release-notes", async () => "after")).resolves.toBe("after");
    await Promise.resolve();
    await Promise.resolve();
    expect(skillSlugLockDepth()).toBe(0);
  });
});
