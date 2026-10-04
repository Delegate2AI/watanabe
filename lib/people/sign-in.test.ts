import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "./types";

const loadPeopleMock = vi.fn<() => Directory>();
const upsertPersonMock = vi.fn<() => Promise<void>>();
vi.mock("./store", () => ({
  loadPeople: (...args: unknown[]) => loadPeopleMock(...(args as [])),
  upsertPerson: (...args: unknown[]) => upsertPersonMock(...(args as [])),
}));

import { __resetPeopleSignInForTests, notePersonName } from "./sign-in";

const savedEnv = { ...process.env };

beforeEach(() => {
  loadPeopleMock.mockReset().mockReturnValue({});
  upsertPersonMock.mockReset().mockResolvedValue(undefined);
  __resetPeopleSignInForTests();
  process.env.PEOPLE_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("notePersonName", () => {
  it("records a name the directory does not have yet", async () => {
    notePersonName("Maria.Chen@example.com", "Maria Chen");

    await vi.waitFor(() => expect(upsertPersonMock).toHaveBeenCalledTimes(1));
    expect(upsertPersonMock).toHaveBeenCalledWith("maria.chen@example.com", {
      name: "Maria Chen",
      source: "idp",
    });
  });

  it("does nothing when the flag is off, without even reading the directory", () => {
    delete process.env.PEOPLE_ENABLED;

    notePersonName("maria.chen@example.com", "Maria Chen");

    expect(loadPeopleMock).not.toHaveBeenCalled();
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("does nothing when the header carries no name", () => {
    notePersonName("maria.chen@example.com", undefined);
    notePersonName("maria.chen@example.com", "   ");

    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("does not persist a header value that is an opaque id rather than a name", () => {
    notePersonName("taylor@example.com", "ybbiiflb2gtz");
    notePersonName("taylor@example.com", "taylor@example.com");

    expect(loadPeopleMock).not.toHaveBeenCalled();
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("does nothing when the stored name already matches", () => {
    loadPeopleMock.mockReturnValue({
      "maria.chen@example.com": { name: "Maria Chen", source: "idp" },
    });

    notePersonName("maria.chen@example.com", "Maria Chen");

    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("leaves a manually edited name alone", () => {
    loadPeopleMock.mockReturnValue({
      "maria.chen@example.com": { name: "M. Chen", source: "manual" },
    });

    notePersonName("maria.chen@example.com", "Maria Chen");

    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("coalesces repeat sign-ins with the same name into one write", async () => {
    notePersonName("maria.chen@example.com", "Maria Chen");
    notePersonName("maria.chen@example.com", "Maria Chen");
    notePersonName("MARIA.CHEN@example.com", "Maria Chen");

    await vi.waitFor(() => expect(upsertPersonMock).toHaveBeenCalledTimes(1));
    expect(loadPeopleMock).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows a rejected upsert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertPersonMock.mockRejectedValue(new Error("commit refused"));

    expect(() => notePersonName("maria.chen@example.com", "Maria Chen")).not.toThrow();

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("commit refused")));
  });

  it("swallows a directory read that blows up", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadPeopleMock.mockImplementation(() => {
      throw new Error("unreadable");
    });

    expect(() => notePersonName("maria.chen@example.com", "Maria Chen")).not.toThrow();
    expect(error).toHaveBeenCalled();
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });
});
