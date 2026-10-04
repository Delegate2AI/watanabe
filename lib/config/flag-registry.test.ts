import { describe, expect, it } from "vitest";
import { FLAG_NAMES, FLAG_REGISTRY } from "./flag-registry";

describe("flag registry", () => {
  it("registers KB_ACCESS_UI_ENABLED depending on AUTHORITY_ENABLED", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "KB_ACCESS_UI_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.dependsOn).toBe("AUTHORITY_ENABLED");
    expect(FLAG_NAMES.has("KB_ACCESS_UI_ENABLED")).toBe(true);
  });

  // The flags tab now disables a flag whose dependency is off and names that
  // dependency in the copy, so a dependsOn pointing at nothing would render a
  // raw environment variable name at an administrator.
  it("points every dependsOn at a flag the registry itself declares", () => {
    const dangling = FLAG_REGISTRY
      .filter((flag) => flag.dependsOn !== undefined && !FLAG_NAMES.has(flag.dependsOn))
      .map((flag) => `${flag.envVar} -> ${flag.dependsOn}`);
    expect(dangling).toEqual([]);
  });

  it("gives every flag a label, a description, and a known effect", () => {
    for (const flag of FLAG_REGISTRY) {
      expect(flag.label.length, flag.envVar).toBeGreaterThan(0);
      expect(flag.description.length, flag.envVar).toBeGreaterThan(0);
      expect(["live", "restart"], flag.envVar).toContain(flag.effect);
    }
  });

  it("registers PEOPLE_ENABLED as a live flag with no dependency", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "PEOPLE_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.effect).toBe("live");
    expect(descriptor?.dependsOn).toBeUndefined();
    expect(FLAG_NAMES.has("PEOPLE_ENABLED")).toBe(true);
  });

  // Nothing reads it at boot, and it is independent of the directory flag: the
  // dashboard degrades to raw emails rather than disappearing with PEOPLE_ENABLED off.
  it("registers PEOPLE_ACTIVITY_ENABLED as a live flag with no dependency", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "PEOPLE_ACTIVITY_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.effect).toBe("live");
    expect(descriptor?.dependsOn).toBeUndefined();
    expect(FLAG_NAMES.has("PEOPLE_ACTIVITY_ENABLED")).toBe(true);
  });

  it("registers task comments as a live flag that depends on tasks", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "TASK_COMMENTS_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.effect).toBe("live");
    expect(descriptor?.dependsOn).toBe("TASKS_ENABLED");
  });
});
