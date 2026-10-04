// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  MODEL_CHOICE_KEY,
  initialChoiceFrom,
  readStoredChoice,
  writeStoredChoice,
} from "./model-choice";
import type { ModelOption } from "@/lib/agent/model-options";

const OPTIONS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("initialChoiceFrom", () => {
  it("keeps a model on the given option list and a real effort level", () => {
    expect(initialChoiceFrom(OPTIONS, { model: "claude-fable-5-1", effort: "max" })).toEqual({
      model: "claude-fable-5-1",
      effort: "max",
    });
  });

  it("drops a model that is not on the list", () => {
    expect(initialChoiceFrom(OPTIONS, { model: "gpt-4o", effort: "low" })).toEqual({
      effort: "low",
    });
  });

  it("drops a bogus effort", () => {
    expect(initialChoiceFrom(OPTIONS, { model: "claude-opus-4-8", effort: "turbo" })).toEqual({
      model: "claude-opus-4-8",
    });
  });

  it("returns an empty choice for empty input", () => {
    expect(initialChoiceFrom(OPTIONS, {})).toEqual({});
    expect(initialChoiceFrom([], { model: "claude-opus-4-8" })).toEqual({});
  });
});

describe("readStoredChoice and writeStoredChoice", () => {
  it("round-trips a choice through localStorage under the spec key", () => {
    writeStoredChoice({ model: "claude-fable-5-1", effort: "max" });
    expect(window.localStorage.getItem(MODEL_CHOICE_KEY)).toBe(
      JSON.stringify({ model: "claude-fable-5-1", effort: "max" }),
    );
    expect(readStoredChoice(OPTIONS)).toEqual({ model: "claude-fable-5-1", effort: "max" });
  });

  it("re-validates the stored value against the current option list", () => {
    window.localStorage.setItem(
      MODEL_CHOICE_KEY,
      JSON.stringify({ model: "claude-retired-9", effort: "high" }),
    );
    expect(readStoredChoice(OPTIONS)).toEqual({ effort: "high" });
  });

  it("returns an empty choice for a missing key and for unparseable JSON", () => {
    expect(readStoredChoice(OPTIONS)).toEqual({});
    window.localStorage.setItem(MODEL_CHOICE_KEY, "{not json");
    expect(readStoredChoice(OPTIONS)).toEqual({});
  });

  it("returns an empty choice when the accessor itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(readStoredChoice(OPTIONS)).toEqual({});
  });

  it("never throws when writing is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeStoredChoice({ model: "claude-fable-5-1" })).not.toThrow();
  });
});
