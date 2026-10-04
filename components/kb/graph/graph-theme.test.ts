// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readGraphPalette, assignGroupSlots, rankGroups, GROUP_HUES } from "./graph-theme";
import type { GraphNode } from "@/lib/kb/graph";

function probeWith(vars: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  document.body.append(el);
  return el;
}

/**
 * The real token file, loaded into the document so the palette is read through
 * the same cascade the browser uses. The probe below sets NOTHING of its own:
 * that is the point, because the graph container on `/map` carries no custom
 * properties either, and the earlier prose-token version of this file passed
 * only because both probes and both modes fell through to the fallbacks.
 */
const TOKENS = readFileSync(
  path.resolve(__dirname, "../../../app/design-tokens.css"),
  "utf8",
);

/** A probe nested two levels below <body>, with no custom properties on it. */
function themedProbe(theme: "light" | "dark"): HTMLElement {
  const style = document.createElement("style");
  style.textContent = TOKENS;
  document.head.append(style);
  document.documentElement.setAttribute("data-theme", theme);
  const outer = document.createElement("div");
  const probe = document.createElement("div");
  outer.append(probe);
  document.body.append(outer);
  return probe;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("readGraphPalette", () => {
  it("takes its colors from the resolved shell tokens, not from constants", () => {
    const probe = probeWith({
      "--surface-2": "rgb(244, 242, 235)",
      "--ink": "rgb(11, 11, 11)",
      "--line": "rgb(200, 200, 200)",
      "--ink-muted": "rgb(90, 90, 90)",
    });

    const palette = readGraphPalette(probe, false);

    expect(palette.surface).toBe("rgb(244, 242, 235)");
    expect(palette.label).toBe("rgb(11, 11, 11)");
    expect(palette.edge).toBe("rgb(200, 200, 200)");
    expect(palette.nodeNeutral).toBe("rgb(90, 90, 90)");
  });

  it("themes off :root through the cascade, so light and dark differ on a bare probe", () => {
    const light = readGraphPalette(themedProbe("light"), false);
    const dark = readGraphPalette(themedProbe("dark"), true);

    // Every non-hue colour has to move with the theme. Reading a token that is
    // not on `:root` leaves all four on the same light fallbacks, which is the
    // bug this asserts against, so compare them one by one rather than in bulk.
    expect(dark.surface).not.toBe(light.surface);
    expect(dark.label).not.toBe(light.label);
    expect(dark.edge).not.toBe(light.edge);
    expect(dark.nodeNeutral).not.toBe(light.nodeNeutral);

    // And the values are the tokens themselves, not merely different.
    expect(light.surface).toBe("#f4f2eb");
    expect(dark.surface).toBe("#2b2926");
    expect(dark.label).toBe("#ece8e0");
  });

  it("falls back to a usable color when a token is missing rather than drawing nothing", () => {
    const palette = readGraphPalette(probeWith({}), false);
    expect(palette.surface).toMatch(/^#|^rgb/);
    expect(palette.label).toMatch(/^#|^rgb/);
  });

  it("selects the dark group steps, which are chosen for the dark surface", () => {
    const light = readGraphPalette(probeWith({}), false);
    const dark = readGraphPalette(probeWith({}), true);

    expect(light.groups).toEqual(GROUP_HUES.map((hue) => hue.light));
    expect(dark.groups).toEqual(GROUP_HUES.map((hue) => hue.dark));
    expect(light.groups).not.toEqual(dark.groups);
  });

  it("carries exactly three group hues, the number the validator clears in both modes", () => {
    expect(GROUP_HUES).toHaveLength(3);
  });
});

describe("rankGroups", () => {
  const NODES: GraphNode[] = [
    { id: "charter", t: "Charter", g: "", d: 0 },
    { id: "a/one", t: "One", g: "a", d: 1 },
    { id: "b/one", t: "One", g: "b", d: 1 },
    { id: "b/two", t: "Two", g: "b", d: 1 },
  ];

  it("orders the groups by note count descending", () => {
    expect(rankGroups(NODES)[0]).toBe("b");
  });

  it("ranks the vault root as a group, so those notes can be coloured and pinned", () => {
    // `g: ""` is what a root-level note carries on the wire. Skipping it left
    // those notes neutral for ever, absent from the legend and unpinnable.
    expect(rankGroups(NODES)).toContain("");
    expect(assignGroupSlots(rankGroups(NODES)).has("")).toBe(true);
  });
});

describe("assignGroupSlots", () => {
  it("gives the first three groups a slot and leaves the rest neutral", () => {
    const slots = assignGroupSlots(["a", "b", "c", "d", "e"]);

    expect(slots.get("a")).toBe(0);
    expect(slots.get("b")).toBe(1);
    expect(slots.get("c")).toBe(2);
    expect(slots.has("d")).toBe(false);
    expect(slots.has("e")).toBe(false);
  });

  it("follows the group, never its rank on screen, so filtering cannot repaint survivors", () => {
    const all = assignGroupSlots(["a", "b", "c"]);
    // "b" and "c" pinned by the legend, "a" is not: b and c must keep the
    // slots they already had.
    const filtered = assignGroupSlots(["a", "b", "c"], new Set(["b", "c"]));

    expect(filtered.get("b")).toBe(all.get("b"));
    expect(filtered.get("c")).toBe(all.get("c"));
  });

  it("promotes a selected group into a slot ahead of an unselected larger one", () => {
    const slots = assignGroupSlots(["a", "b", "c", "d"], new Set(["d"]));
    expect(slots.get("d")).toBeDefined();
  });

  it("keeps a survivor's slot stable as the selected set grows, and on the return trip back down", () => {
    const step1 = assignGroupSlots(["a", "b", "c", "d"], new Set(["c"]));
    expect(step1.get("a")).toBe(0);
    expect(step1.get("b")).toBe(1);
    expect(step1.get("c")).toBe(2);

    // "d" joins the selection: "a" and "c" were already slotted and must not move.
    const step2 = assignGroupSlots(["a", "b", "c", "d"], new Set(["c", "d"]), step1);
    expect(step2.get("a")).toBe(step1.get("a"));
    expect(step2.get("c")).toBe(step1.get("c"));

    // Return trip, "c" drops out again: "d" must keep the slot it was just given.
    const step3 = assignGroupSlots(["a", "b", "c", "d"], new Set(["d"]), step2);
    expect(step3.get("a")).toBe(step2.get("a"));
    expect(step3.get("d")).toBe(step2.get("d"));
  });

  it("keeps a survivor's slot stable as the selected set shrinks", () => {
    const step1 = assignGroupSlots(["a", "b", "c", "d", "e"], new Set(["d", "e"]));
    expect(step1.get("a")).toBe(0);
    expect(step1.get("d")).toBe(1);
    expect(step1.get("e")).toBe(2);

    // "e" drops out of the selection: "a" and "d" must not move.
    const step2 = assignGroupSlots(["a", "b", "c", "d", "e"], new Set(["d"]), step1);
    expect(step2.get("a")).toBe(step1.get("a"));
    expect(step2.get("d")).toBe(step1.get("d"));
  });
});
