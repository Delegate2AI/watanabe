import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  modelAllowlist,
  isAllowedModel,
  isModelSwitchingEnabled,
  resolveModelChoice,
  defaultModelId,
  labelForModel,
  labelForEffort,
  EFFORT_LEVELS,
  DEFAULT_EFFORT,
} from "./model-options";

const ORIGINAL = { model: process.env.AGENT_CHAT_MODEL, models: process.env.AGENT_CHAT_MODELS };

beforeEach(() => {
  delete process.env.AGENT_CHAT_MODEL;
  delete process.env.AGENT_CHAT_MODELS;
});
afterEach(() => {
  if (ORIGINAL.model === undefined) delete process.env.AGENT_CHAT_MODEL;
  else process.env.AGENT_CHAT_MODEL = ORIGINAL.model;
  if (ORIGINAL.models === undefined) delete process.env.AGENT_CHAT_MODELS;
  else process.env.AGENT_CHAT_MODELS = ORIGINAL.models;
});

describe("modelAllowlist", () => {
  it("always includes the env default first, with its curated label, hint and tier", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    const list = modelAllowlist();
    expect(list[0]).toEqual({
      id: "claude-opus-4-8",
      label: "Opus 4.8",
      hint: "Current default",
      tier: 2,
    });
  });

  it("adds AGENT_CHAT_MODELS entries, de-duplicated against the default", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-opus-4-8, claude-sonnet-4-6";
    const ids = modelAllowlist().map((m) => m.id);
    expect(ids).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("labels every id the deploy list names from the table", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS =
      "claude-fable-5-1,claude-opus-5,claude-sonnet-5,claude-haiku-4-5-20251001";
    expect(modelAllowlist()).toEqual([
      { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Current default", tier: 2 },
      { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable", tier: 3 },
      { id: "claude-opus-5", label: "Opus 5", hint: "Best all-round", tier: 2 },
      { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Fast", tier: 1 },
      {
        id: "claude-haiku-4-5-20251001",
        label: "Haiku 4.5",
        hint: "Fastest, cheapest",
        tier: 0,
      },
    ]);
  });

  it("falls back to the regex label for an id the table does not know, with no hint or tier", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-sonnet-4-6";
    const sonnet = modelAllowlist().find((m) => m.id === "claude-sonnet-4-6");
    expect(sonnet).toEqual({ id: "claude-sonnet-4-6", label: "Sonnet 4.6" });
  });

  it("renders a wholly unrecognised id as its raw id rather than hiding it", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "some-future-model";
    const found = modelAllowlist().find((m) => m.id === "some-future-model");
    expect(found).toEqual({ id: "some-future-model", label: "some-future-model" });
  });

  it("has no bare claude-haiku-4-5 entry, because the key does not serve one", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-haiku-4-5";
    const found = modelAllowlist().find((m) => m.id === "claude-haiku-4-5");
    expect(found).toEqual({ id: "claude-haiku-4-5", label: "Haiku 4.5" });
    expect(found?.tier).toBeUndefined();
  });
});

describe("isModelSwitchingEnabled", () => {
  it("is off unless AGENT_CHAT_MODELS is a non-empty list", () => {
    expect(isModelSwitchingEnabled()).toBe(false);
    process.env.AGENT_CHAT_MODELS = "  ";
    expect(isModelSwitchingEnabled()).toBe(false);
    process.env.AGENT_CHAT_MODELS = "claude-sonnet-4-6";
    expect(isModelSwitchingEnabled()).toBe(true);
  });
});

describe("resolveModelChoice", () => {
  beforeEach(() => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
  });

  it("defaults to the env model at High when nothing is chosen", () => {
    expect(resolveModelChoice()).toEqual({ model: defaultModelId(), effort: DEFAULT_EFFORT });
  });

  it("honors an allow-listed model and a valid effort", () => {
    process.env.AGENT_CHAT_MODELS = "claude-sonnet-4-6";
    expect(resolveModelChoice({ model: "claude-sonnet-4-6", effort: "low" })).toEqual({
      model: "claude-sonnet-4-6",
      effort: "low",
    });
  });

  it("drops an off-allowlist model back to the default", () => {
    expect(resolveModelChoice({ model: "gpt-4o", effort: "max" })).toEqual({
      model: "claude-opus-4-8",
      effort: "max",
    });
  });

  it("drops a bogus effort back to High", () => {
    expect(resolveModelChoice({ model: "claude-opus-4-8", effort: "turbo" as never })).toEqual({
      model: "claude-opus-4-8",
      effort: "high",
    });
  });

  it("isAllowedModel gates the same set the allowlist exposes", () => {
    expect(isAllowedModel("claude-opus-4-8")).toBe(true);
    expect(isAllowedModel("gpt-4o")).toBe(false);
  });
});

describe("labelForModel", () => {
  const OPTIONS = [
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-fable-5-1", label: "Fable 5.1" },
  ];

  it("returns the label of the matching option", () => {
    expect(labelForModel(OPTIONS, "claude-fable-5-1")).toBe("Fable 5.1");
  });

  it("falls back to the first option when the id is absent or unknown", () => {
    expect(labelForModel(OPTIONS)).toBe("Opus 4.8");
    expect(labelForModel(OPTIONS, "gpt-4o")).toBe("Opus 4.8");
  });

  it("falls back to the env default label when there are no options at all", () => {
    expect(labelForModel([])).toBe("Opus 4.8");
  });
});

describe("labelForEffort", () => {
  it("title-cases a real level", () => {
    for (const level of EFFORT_LEVELS) {
      expect(labelForEffort(level)).toBe(level.charAt(0).toUpperCase() + level.slice(1));
    }
  });

  it("falls back to High for anything else", () => {
    expect(labelForEffort()).toBe("High");
    expect(labelForEffort("turbo")).toBe("High");
    expect(labelForEffort(null)).toBe("High");
  });
});
