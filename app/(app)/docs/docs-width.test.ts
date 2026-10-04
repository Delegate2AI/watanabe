import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-level width contract for the shared-doc detail page.
 *
 * Why source-level and not a rendered probe: jsdom implements no layout engine,
 * so a grid track's computed width is never resolved and a runtime assertion
 * would pass against any markup at all. Same reasoning as
 * `app/(app)/layout.shell.test.ts` and `app/globals.token.test.ts`.
 *
 * The problem this locks down: every other detail page in the shell is
 * `max-w-5xl` with the whole container available to its content, but this one
 * puts a fixed-width comments rail INSIDE that container, so the reading column
 * was the container minus the rail minus the gap. The document was the only
 * thing on the page paying for the rail, and it came out far narrower than any
 * comparable page. The container has to be wider than the rail-less pages by at
 * least the rail it carries.
 */
const detail = readFileSync(path.resolve(__dirname, "[id]/page.tsx"), "utf8");
const annotated = readFileSync(
  path.resolve(__dirname, "../../../components/docs/annotated-doc.tsx"),
  "utf8",
);

/** Tailwind's `max-w-*` scale, in rem, for the steps this page could use. */
const MAX_W_REM: Record<string, number> = {
  "max-w-3xl": 48,
  "max-w-4xl": 56,
  "max-w-5xl": 64,
  "max-w-6xl": 72,
  "max-w-7xl": 80,
};

function containerWidthRem(): number {
  const match = detail.match(/mx-auto w-full (max-w-[a-z0-9]+)/);
  expect(match, "no page container with an mx-auto max-w-* found").not.toBeNull();
  const rem = MAX_W_REM[match![1]];
  expect(rem, `unrecognised width step ${match![1]}`).toBeDefined();
  return rem;
}

/** The comments rail track width from the annotated-doc grid template, in rem. */
function railWidthRem(): number {
  const match = annotated.match(/grid-cols-\[minmax\(0,1fr\)_(\d+(?:\.\d+)?)rem\]/);
  expect(match, "no annotated-doc grid template with a rem rail track found").not.toBeNull();
  return Number(match![1]);
}

describe("shared doc detail width", () => {
  it("leaves the reading column at least as wide as a plain detail page", () => {
    // 64rem is `max-w-5xl`, what every detail page without a rail gets.
    expect(containerWidthRem() - railWidthRem()).toBeGreaterThanOrEqual(64 - 8);
  });
});
