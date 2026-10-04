import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "./types";

const loadPeopleMock = vi.fn<() => Directory>();
vi.mock("./store", () => ({
  loadPeople: (...args: unknown[]) => loadPeopleMock(...(args as [])),
}));

import { resolvePeople, resolvePerson, viewerName } from "./resolve";

const savedEnv = { ...process.env };

beforeEach(() => {
  loadPeopleMock.mockReset().mockReturnValue({});
  process.env.PEOPLE_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("resolvePerson with the flag on", () => {
  it("returns the stored name and its initials on a directory hit", () => {
    loadPeopleMock.mockReturnValue({
      "mchen@example.com": { name: "Maria Chen", source: "idp" },
    });

    expect(resolvePerson("MChen@example.com")).toEqual({
      email: "mchen@example.com",
      name: "Maria Chen",
      initials: "MC",
      isSelf: false,
    });
  });

  it.each([
    ["maria.chen@example.com", "Maria Chen", "MC"],
    ["taylor@example.com", "Taylor", "T"],
    ["j.r.smith@example.com", "J R Smith", "JS"],
    ["devon_brooks@example.com", "Devon Brooks", "DB"],
    ["alex-kim@example.com", "Alex Kim", "AK"],
    ["maria.chen+kb@example.com", "Maria Chen", "MC"],
  ])("humanizes %s to %s on a miss", (email, name, initials) => {
    expect(resolvePerson(email)).toMatchObject({ name, initials });
  });

  it("falls back to the email when the local part humanizes to nothing", () => {
    expect(resolvePerson("+++@example.com")).toMatchObject({
      name: "+++@example.com",
      initials: "?",
    });
  });

  it("marks the viewer as self, case-insensitively", () => {
    expect(resolvePerson("Maria.Chen@example.com", { viewerEmail: "maria.chen@EXAMPLE.com" }))
      .toMatchObject({ isSelf: true });
    expect(resolvePerson("maria.chen@example.com", { viewerEmail: "someone@example.com" }))
      .toMatchObject({ isSelf: false });
  });

  it("returns the input unchanged for an empty or malformed email", () => {
    expect(resolvePerson("")).toEqual({ email: "", name: "", initials: "?", isSelf: false });
    expect(resolvePerson("not-an-email")).toEqual({
      email: "not-an-email",
      name: "not-an-email",
      initials: "?",
      isSelf: false,
    });
  });

  it("degrades to the email when the directory read blows up", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadPeopleMock.mockImplementation(() => {
      throw new Error("unreadable");
    });

    expect(resolvePerson("maria.chen@example.com")).toEqual({
      email: "maria.chen@example.com",
      name: "maria.chen@example.com",
      initials: "M",
      isSelf: false,
    });
    expect(error).toHaveBeenCalled();
  });
});

describe("resolvePerson with the flag off", () => {
  beforeEach(() => {
    delete process.env.PEOPLE_ENABLED;
  });

  it("returns the raw email as the name and never reads the directory", () => {
    expect(resolvePerson("maria.chen@example.com", { viewerEmail: "maria.chen@example.com" })).toEqual({
      email: "maria.chen@example.com",
      name: "maria.chen@example.com",
      initials: "M",
      isSelf: false,
    });
    expect(loadPeopleMock).not.toHaveBeenCalled();
  });
});

describe("resolvePeople", () => {
  it("loads the directory once for the whole batch", () => {
    loadPeopleMock.mockReturnValue({
      "mchen@example.com": { name: "Maria Chen", source: "idp" },
    });

    const people = resolvePeople(
      ["MChen@example.com", "devon.brooks@example.com", "mchen@example.com"],
      { viewerEmail: "devon.brooks@example.com" },
    );

    expect(loadPeopleMock).toHaveBeenCalledTimes(1);
    expect(people["mchen@example.com"].name).toBe("Maria Chen");
    expect(people["devon.brooks@example.com"]).toMatchObject({ name: "Devon Brooks", isSelf: true });
  });

  it("returns an empty map for no emails without reading the directory", () => {
    expect(resolvePeople([])).toEqual({});
    expect(loadPeopleMock).not.toHaveBeenCalled();
  });
});

describe("an idp row holding an opaque id", () => {
  it("is ignored in favor of the humanized address", () => {
    loadPeopleMock.mockReturnValue({
      "taylor@example.com": { name: "ybbiiflb2gtz", source: "idp" },
    });

    expect(resolvePerson("taylor@example.com")).toMatchObject({ name: "Taylor", initials: "T" });
  });

  it("is honored when an admin typed it, however odd it looks", () => {
    loadPeopleMock.mockReturnValue({
      "taylor@example.com": { name: "ybbiiflb2gtz", source: "manual" },
    });

    expect(resolvePerson("taylor@example.com")).toMatchObject({ name: "ybbiiflb2gtz" });
  });
});

describe("viewerName with the flag on", () => {
  it("prefers the directory over the name the identity provider sent", () => {
    loadPeopleMock.mockReturnValue({
      "taylor@example.com": { name: "Taylor Reed", source: "manual" },
    });

    expect(viewerName("taylor@example.com", "ybbiiflb2gtz")).toEqual({
      name: "Taylor Reed",
      initials: "TR",
    });
  });

  it("humanizes the address rather than showing an opaque header name", () => {
    expect(viewerName("taylor@example.com", "ybbiiflb2gtz")).toEqual({ name: "Taylor", initials: "T" });
  });
});

describe("viewerName with the flag off", () => {
  beforeEach(() => {
    delete process.env.PEOPLE_ENABLED;
  });

  it("shows the header name, then the email local part, and reads no directory", () => {
    expect(viewerName("taylor@example.com", "  Taylor Reed  ")).toEqual({
      name: "Taylor Reed",
      initials: "T",
    });
    expect(viewerName("taylor@example.com")).toEqual({ name: "taylor", initials: "T" });
    expect(loadPeopleMock).not.toHaveBeenCalled();
  });
});
