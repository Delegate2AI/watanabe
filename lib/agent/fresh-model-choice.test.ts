// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread, setThreadModelChoice } from "@/lib/db/threads";
import { freshModelChoiceFor } from "./fresh-model-choice";

const OWNER = "alice@example.com";
const THREAD = "11111111-1111-4111-8111-111111111111";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("freshModelChoiceFor", () => {
  it("returns null when nothing was requested", () => {
    expect(freshModelChoiceFor(db, undefined, {})).toBeNull();
    expect(freshModelChoiceFor(db, undefined, { model: undefined, effort: undefined })).toBeNull();
  });

  it("applies the request when there is no thread at all", () => {
    expect(
      freshModelChoiceFor(db, undefined, { model: "claude-fable-5-1", effort: "max" }),
    ).toEqual({
      model: "claude-fable-5-1",
      effort: "max",
    });
  });

  it("applies the request when the thread row exists but holds no model", () => {
    recordThread(db, THREAD, OWNER, undefined);
    expect(freshModelChoiceFor(db, THREAD, { model: "claude-fable-5-1" })).toEqual({
      model: "claude-fable-5-1",
    });
  });

  it("applies the request when the thread row does not exist yet", () => {
    expect(freshModelChoiceFor(db, THREAD, { model: "claude-fable-5-1" })).toEqual({
      model: "claude-fable-5-1",
    });
  });

  it("refuses to override a model already stored on the thread", () => {
    recordThread(db, THREAD, OWNER, "a chat");
    setThreadModelChoice(db, THREAD, OWNER, { model: "claude-sonnet-5" });
    expect(freshModelChoiceFor(db, THREAD, { model: "claude-fable-5-1", effort: "max" })).toBeNull();
  });

  it("applies an effort-only request when the row holds an effort but no model", () => {
    recordThread(db, THREAD, OWNER, "a chat");
    setThreadModelChoice(db, THREAD, OWNER, { effort: "low" });
    expect(freshModelChoiceFor(db, THREAD, { effort: "max" })).toEqual({ effort: "max" });
  });

  it("degrades to applying the request when the store read throws", () => {
    const broken = {
      prepare: () => {
        throw new Error("db gone");
      },
    } as unknown as DatabaseType;
    expect(freshModelChoiceFor(broken, THREAD, { model: "claude-fable-5-1" })).toEqual({
      model: "claude-fable-5-1",
    });
  });
});
