import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves with the promise's value when it settles before the deadline", async () => {
    const onTimeout = vi.fn();
    const result = await withTimeout(Promise.resolve("done"), 1000, onTimeout);
    expect(result).toBe("done");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the promise when it rejects before the deadline", async () => {
    const onTimeout = vi.fn();
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, onTimeout)).rejects.toThrow("boom");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("calls onTimeout and resolves undefined when the deadline fires first", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const neverSettles = new Promise<string>(() => {});
    const pending = withTimeout(neverSettles, 50, onTimeout);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result).toBeUndefined();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("clears the timer once the promise settles first, leaving nothing dangling", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    await withTimeout(Promise.resolve("fast"), 1000, vi.fn());
    expect(clearSpy).toHaveBeenCalled();
  });

  it("settles within the deadline even when onTimeout returns a promise that never resolves", async () => {
    // Regression guard: withTimeout used to `await onTimeout()` on the
    // timeout branch. A wedged subprocess that also ignores its interrupt
    // request (dream.ts's onTimeout calls q.interrupt()) would then hang
    // onTimeout forever, which hung withTimeout forever, which deadlocked
    // withMemoryLock and every dream behind it. withTimeout must settle on
    // its own regardless of how long onTimeout takes.
    const onTimeout = () => new Promise<void>(() => {}); // never settles
    const neverSettles = new Promise<string>(() => {});
    const ms = 20;
    const start = Date.now();
    const result = await withTimeout(neverSettles, ms, onTimeout);
    const elapsed = Date.now() - start;
    expect(result).toBeUndefined();
    // Generous bound versus the 20ms deadline: proves withTimeout did not
    // wait on the never-resolving onTimeout promise.
    expect(elapsed).toBeLessThan(ms + 500);
  });

  it("swallows a synchronous throw from onTimeout without rejecting", async () => {
    vi.useFakeTimers();
    const onTimeout = () => {
      throw new Error("boom");
    };
    const pending = withTimeout(new Promise<string>(() => {}), 50, onTimeout);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBeUndefined();
  });
});
