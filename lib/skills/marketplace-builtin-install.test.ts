import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import {
  BUILTIN_MARKETPLACE_ID,
  installFromMarketplace,
  type GitInstaller,
} from "./marketplace";

/**
 * That `installFromMarketplace` accepts the built-in source's id.
 *
 * The id is a sentinel rather than a URL, so it cannot pass the http(s) check
 * every other index id is held to. The acceptance is an exact match against a
 * constant, and these tests are what keep it exact: a prefix match, a
 * `startsWith`, or a `.includes` would open a hole in the one guard that stops a
 * remote document from naming a local path.
 *
 * The installer is injected and records only. What the git pipeline then does
 * with a real repository is marketplace-install.test.ts's job; the question here
 * is purely whether the index id was accepted before anything ran.
 */

let seen: Array<{ url: string; ref: string; subdir?: string }>;

const recorder: GitInstaller = async (opts) => {
  seen.push(opts);
  return { ok: false, reason: "recorded" };
};

const pick = (index: string) => ({
  index,
  name: "webapp-testing",
  description: "Drive a local web app with Playwright.",
  url: "https://github.com/anthropics/skills",
  subdir: "skills/webapp-testing",
});

beforeEach(() => {
  resetConfigForTests();
  seen = [];
});

afterEach(() => {
  resetConfigForTests();
});

describe("the built-in index id at install time", () => {
  it("is accepted, and the entry's url and subdir reach the installer", async () => {
    await installFromMarketplace(pick(BUILTIN_MARKETPLACE_ID), recorder);

    expect(seen).toEqual([
      { url: "https://github.com/anthropics/skills", ref: "main", subdir: "skills/webapp-testing" },
    ]);
  });

  it.each([
    ["a different builtin-looking id", "builtin:something-else"],
    ["the sentinel with trailing space", `${BUILTIN_MARKETPLACE_ID} `],
    ["the sentinel as a prefix", `${BUILTIN_MARKETPLACE_ID}.evil.example.com`],
    ["a local path", "file:///etc/passwd"],
  ])("refuses %s before the installer runs", async (_label, index) => {
    const result = await installFromMarketplace(pick(index), recorder);

    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it("treats a real URL that merely contains the sentinel as an ordinary index", async () => {
    // Accepted HERE, and correctly so: it is a well-formed https index url, and
    // this layer's only question about `index` is the scheme. What stops it is
    // the allow-list one layer up in admin-actions, which asks whether the id is
    // one of `marketplaceSourceIds()`. The property under test is that it does
    // not get the BUILT-IN treatment, so the bundled document is never what a
    // url-shaped id resolves to.
    const result = await installFromMarketplace(
      pick(`https://evil.example.com/${BUILTIN_MARKETPLACE_ID}`),
      recorder,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("recorded");
    expect(seen).toHaveLength(1);
  });
});
