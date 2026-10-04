import { afterEach, describe, expect, it, vi } from "vitest";

import { evictAllWarmSessions, evictSessionsForOwner } from "./session-evict-all";

interface FakeSession {
  owner: string;
  evictWhenIdle: () => void;
}

/** The globalThis-pinned registry `session.ts` owns and this module reaches. */
const registry = globalThis as unknown as {
  __agentChatSessions?: Map<string, FakeSession>;
};

function seed(count: number, owner = "unused@example.com"): ReturnType<typeof vi.fn>[] {
  const map = new Map<string, FakeSession>();
  const spies = Array.from({ length: count }, (_unused, index) => {
    const evictWhenIdle = vi.fn();
    map.set(`session-${index}`, { owner, evictWhenIdle });
    return evictWhenIdle;
  });
  registry.__agentChatSessions = map;
  return spies;
}

afterEach(() => {
  delete registry.__agentChatSessions;
});

describe("evictAllWarmSessions", () => {
  it("evicts every warm session and reports how many", () => {
    const spies = seed(3);

    expect(evictAllWarmSessions()).toBe(3);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports zero when nothing is warm", () => {
    seed(0);

    expect(evictAllWarmSessions()).toBe(0);
  });

  it("reports zero when no session has ever been constructed", () => {
    delete registry.__agentChatSessions;

    expect(evictAllWarmSessions()).toBe(0);
  });

  it("evicts the rest when one session throws", () => {
    const spies = seed(3);
    spies[1]!.mockImplementation(() => {
      throw new Error("dispose blew up");
    });

    expect(() => evictAllWarmSessions()).not.toThrow();
    expect(spies[0]).toHaveBeenCalledTimes(1);
    expect(spies[2]).toHaveBeenCalledTimes(1);
  });

  it("evicts every session even when eviction unregisters it mid-pass", () => {
    // What a real idle session does: `evictWhenIdle` calls `dispose`, which
    // removes it from this same map. Iterating the live map instead of a
    // snapshot would leave that mutation deciding who gets visited.
    const map = new Map<string, FakeSession>();
    const seen: string[] = [];
    for (const id of ["a", "b", "c"]) {
      map.set(id, {
        owner: "unused@example.com",
        evictWhenIdle: () => {
          seen.push(id);
          map.delete(id);
        },
      });
    }
    registry.__agentChatSessions = map;

    expect(evictAllWarmSessions()).toBe(3);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(map.size).toBe(0);
  });
});

describe("evictSessionsForOwner", () => {
  it("evicts only the sessions owned by the given email", () => {
    const map = new Map<string, FakeSession>();
    const aliceEvict = vi.fn();
    const bobEvict = vi.fn();
    map.set("s1", { owner: "alice@example.com", evictWhenIdle: aliceEvict });
    map.set("s2", { owner: "bob@example.com", evictWhenIdle: bobEvict });
    registry.__agentChatSessions = map;

    expect(evictSessionsForOwner("alice@example.com")).toBe(1);
    expect(aliceEvict).toHaveBeenCalledTimes(1);
    expect(bobEvict).not.toHaveBeenCalled();
  });

  it("reports zero when no session has ever been constructed", () => {
    delete registry.__agentChatSessions;

    expect(evictSessionsForOwner("alice@example.com")).toBe(0);
  });

  it("reports zero when the owner has no warm sessions", () => {
    seed(2, "bob@example.com");

    expect(evictSessionsForOwner("alice@example.com")).toBe(0);
  });

  it("evicts the rest of the owner's sessions when one throws", () => {
    const map = new Map<string, FakeSession>();
    const first = vi.fn(() => {
      throw new Error("dispose blew up");
    });
    const second = vi.fn();
    map.set("s1", { owner: "alice@example.com", evictWhenIdle: first });
    map.set("s2", { owner: "alice@example.com", evictWhenIdle: second });
    registry.__agentChatSessions = map;

    expect(() => evictSessionsForOwner("alice@example.com")).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
