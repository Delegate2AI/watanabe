import { BUNDLED_FONTS } from "@/lib/agent/design-house-style";
import { MAX_DESIGN_GUIDE_BYTES } from "./config";

/**
 * What an admin is not allowed to save into the house style.
 *
 * The split into constraints and house style already means no edit here can
 * reach the renderer's contract: the constraints are emitted first, from code,
 * whatever this file says. These checks catch the narrower case where an admin
 * writes guidance that CONTRADICTS the constraints, which produces a model
 * receiving two opposite instructions and a document that fails quietly weeks
 * later. Each one is a thing that cannot be intended, not a matter of taste, so
 * a save is refused rather than warned about.
 *
 * A mistake-catcher, not an adversary-proof filter, and the difference is worth
 * stating rather than discovering. An admin who wants to write guidance that
 * evades these patterns can (a CSS `font` shorthand, a protocol-relative host
 * spelled oddly), and the same admin can already register a connector or install
 * a skill, which put arbitrary tools and arbitrary instructions in front of the
 * same model. Tightening these regexes further buys nothing that those two
 * surfaces do not already give away.
 */

export interface GuideProblem {
  /** 1-indexed, so the editor can point at the line. 0 for a whole-file problem. */
  line: number;
  reason: string;
}

export type GuideCheck = { ok: true } | { ok: false; problems: GuideProblem[] };

/**
 * Generic families a font-family declaration may end on. Naming one is not a
 * request for a face we do not have, it is the fallback the constraints ask for.
 */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "inherit",
  "initial",
  "unset",
  "georgia",
  "times",
  '"times new roman"',
  "courier",
  "menlo",
  "consolas",
  "helvetica",
  "arial",
]);

const BUNDLED = new Set(BUNDLED_FONTS.map((family) => family.toLowerCase()));

/** Every family named in one `font-family:` declaration, unquoted and lowercased. */
function familiesIn(declaration: string): string[] {
  return (
    declaration
      // Whole `var(...)` expressions first, fallback included. A custom property
      // is a legitimate way to name a face and is not a name we can check, and
      // it carries its own comma, so splitting first invents two families out of
      // `var(--body-font, Inter)`.
      .replace(/var\([^)]*\)?/gi, "")
      .split(",")
      .map((family) => family.trim().replace(/^["']|["'];?$/g, "").replace(/;$/, "").trim().toLowerCase())
      .filter((family) => family !== "")
  );
}

/**
 * A line that FORBIDS the thing it names is guidance, not a contradiction.
 *
 * Without this, an admin reinforcing a constraint ("never emit a <script> tag")
 * is refused by the rule that agrees with them, which reads as the surface being
 * broken. A word-level heuristic, and it is only ever permissive: the fixed half
 * still carries the real prohibition.
 */
const NEGATED = /\b(?:never|no|not|avoid|don't|do not|without)\b/i;

/**
 * Blank to a reader but not to `trim()`.
 *
 * A guide of nothing but zero-width spaces would pass the empty check, commit,
 * and then be served as real guidance with nothing in it.
 */
const INVISIBLE = /[​-‍﻿⁠]/g;

export function checkDesignGuide(text: string): GuideCheck {
  const problems: GuideProblem[] = [];

  if (typeof text !== "string" || text.replace(INVISIBLE, "").trim() === "") {
    return { ok: false, problems: [{ line: 0, reason: "The guide cannot be empty. Restore the built-in guide instead." }] };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_DESIGN_GUIDE_BYTES) {
    problems.push({
      line: 0,
      reason: `The guide is ${bytes} bytes and the limit is ${MAX_DESIGN_GUIDE_BYTES}. It is prepended to every session's system prompt.`,
    });
  }

  text.split("\n").forEach((line, index) => {
    const at = index + 1;
    const forbidding = NEGATED.test(line);
    if (!forbidding && /<script\b/i.test(line)) {
      problems.push({ line: at, reason: "Script does not run in the reader's frame or in the renderer, so asking for it produces a document that silently does nothing." });
    }
    if (!forbidding && /fonts\.googleapis\.com/i.test(line)) {
      problems.push({ line: at, reason: "The renderer blocks every outbound request. A linked font leaves the downloaded file in a fallback face." });
    }
    // Protocol-relative too: `//cdn.example/x.png` is a remote fetch that never
    // spells out a scheme.
    if (!forbidding && /\bhttps?:\/\/|(?:^|[\s("'])\/\/[a-z0-9-]+\.[a-z]/i.test(line)) {
      problems.push({ line: at, reason: "No URL belongs in the guide: a document that fetches anything is blank when it is opened offline." });
    }
    // Every declaration on the line, not the first: two of them separated by a
    // semicolon used to mean only one was ever looked at.
    for (const declaration of line.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
      for (const family of familiesIn(declaration[1])) {
        if (BUNDLED.has(family) || GENERIC_FAMILIES.has(family)) continue;
        problems.push({
          line: at,
          reason: `"${family}" is not one of the bundled families (${BUNDLED_FONTS.join(", ")}) and would silently fall back.`,
        });
      }
    }
  });

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
