import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { deleteModelGroup, listModelGroups, upsertModelGroup } from "./llm-groups";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("llm model groups", () => {
  it("round-trips the pattern list and an unlimited default, ordered by slug", () => {
    upsertModelGroup(db, { slug: "local", label: "Local", models: ["ollama/*"], defaultTokens: null, period: "day" }, "t");
    upsertModelGroup(db, { slug: "frontier", label: "Frontier", models: ["anthropic/claude-opus-*"], defaultTokens: 100, period: "week" }, "t");
    expect(listModelGroups(db)).toEqual([
      { slug: "frontier", label: "Frontier", models: ["anthropic/claude-opus-*"], defaultTokens: 100, period: "week" },
      { slug: "local", label: "Local", models: ["ollama/*"], defaultTokens: null, period: "day" },
    ]);
  });

  it("updates in place on a second upsert and deletes by slug", () => {
    upsertModelGroup(db, { slug: "local", label: "Local", models: [], defaultTokens: 1, period: "day" }, "t1");
    upsertModelGroup(db, { slug: "local", label: "Local GPU", models: ["ollama/*"], defaultTokens: 2, period: "month" }, "t2");
    expect(listModelGroups(db)).toEqual([{ slug: "local", label: "Local GPU", models: ["ollama/*"], defaultTokens: 2, period: "month" }]);
    expect(deleteModelGroup(db, "local")).toBe(true);
    expect(deleteModelGroup(db, "local")).toBe(false);
  });

  it("reads a corrupt pattern list as empty rather than throwing", () => {
    upsertModelGroup(db, { slug: "x", label: "X", models: [], defaultTokens: null, period: "day" }, "t");
    db.prepare(`UPDATE llm_model_groups SET models = 'not json'`).run();
    expect(listModelGroups(db)[0].models).toEqual([]);
  });
});
