import { describe, it, expect, vi } from "vitest";
import { SessionBroadcaster } from "./session-broadcast";
import type { AgentEvent } from "./events";

const EVENT: AgentEvent = { type: "status", text: "working" };

describe("SessionBroadcaster", () => {
  it("delivers an event to every subscriber", () => {
    const b = new SessionBroadcaster();
    const a = vi.fn();
    const c = vi.fn();
    b.subscribe(a);
    b.subscribe(c);
    b.emit(EVENT);
    expect(a).toHaveBeenCalledWith(EVENT);
    expect(c).toHaveBeenCalledWith(EVENT);
  });

  it("stops delivering after unsubscribe", () => {
    const b = new SessionBroadcaster();
    const fn = vi.fn();
    const off = b.subscribe(fn);
    off();
    b.emit(EVENT);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a throwing subscriber does not stop its siblings", () => {
    const b = new SessionBroadcaster();
    const survivor = vi.fn();
    b.subscribe(() => {
      throw new Error("dead subscriber");
    });
    b.subscribe(survivor);
    expect(() => b.emit(EVENT)).not.toThrow();
    expect(survivor).toHaveBeenCalledWith(EVENT);
  });
});
