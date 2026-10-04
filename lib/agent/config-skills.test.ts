import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HookJSONOutput, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";

/**
 * Spec 34 task 8: the materialized skills plugin reaches the SDK through
 * `buildOptions`, and NOTHING else about the options changes.
 *
 * The strictest instance of the flag-off rule in this spec: every session in the
 * app goes through `buildOptions`, so with `SKILLS_ENABLED` unset the serialized
 * options must be byte-for-byte what they are today. No `plugins` key, not an
 * empty array, not an undefined-valued key. That is asserted by comparing the
 * exact serialization (insertion order included), not by a deep-equal.
 */

const noopHook = async (): Promise<HookJSONOutput> => ({});
const noopCanUseTool = async (): Promise<PermissionResult> => ({ behavior: "allow" });
const noopWriteContext: KbWriteContext = { getThreadId: () => "test-thread", ownerEmail: "test@example.com" };

const { buildOptions } = await import("./config");

type Options = ReturnType<typeof buildOptions>;

/**
 * Byte-level serialization of the options object. Key insertion order is
 * preserved by `JSON.stringify`, so an added or reordered key changes the
 * string. `mcpServers` holds fresh live server instances per call and is
 * compared by key list separately.
 */
function serialize(opts: Options): string {
  const rest: Record<string, unknown> = { ...opts };
  delete rest.mcpServers;
  return JSON.stringify(rest, (_key, value) => (typeof value === "function" ? "[function]" : value));
}

/** The exact top-level key order `buildOptions` produced before spec 34. */
const KEYS_BEFORE_SPEC_34 = [
  "model",
  "cwd",
  "settingSources",
  "systemPrompt",
  "permissionMode",
  "allowedTools",
  "mcpServers",
  "includePartialMessages",
  "hooks",
  "canUseTool",
  "maxBudgetUsd",
  "maxTurns",
  "env",
];

const PLUGIN_PATH = "/tmp/skills-materialized/abc123def4567890";
const SLUGS = ["brand-guidelines", "deal-memo"];

function build(skillsPlugin?: { pluginPath: string; slugs: string[] } | null): Options {
  return buildOptions(
    noopHook,
    noopCanUseTool,
    noopWriteContext,
    undefined,
    undefined,
    ["all-hands"],
    null,
    undefined,
    undefined,
    skillsPlugin,
  );
}

/** What the session hands over when materialization succeeded. */
function materialized(slugs: string[] = SLUGS): { pluginPath: string; slugs: string[] } {
  return { pluginPath: PLUGIN_PATH, slugs };
}

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("buildOptions with SKILLS_ENABLED off", () => {
  beforeEach(() => {
    delete process.env.SKILLS_ENABLED;
  });

  it("produces the pre-spec-34 key set, with no plugins and no skills key at all", () => {
    const opts = build();
    expect(Object.keys(opts)).toEqual(KEYS_BEFORE_SPEC_34);
    expect("plugins" in opts).toBe(false);
    // Not an empty array either: an omitted `skills` leaves the CLI's own
    // defaults alone, which is exactly today's behavior (sdk.d.ts:1863).
    expect("skills" in opts).toBe(false);
  });

  it("is byte-identical whether or not a materialization is passed (flag is the backstop)", () => {
    const withoutPlugin = serialize(build());
    const withPlugin = serialize(build(materialized()));
    expect(withPlugin).toBe(withoutPlugin);
    expect(withPlugin).not.toContain("plugins");
    expect(withPlugin).not.toContain("skills");
    expect(withPlugin).not.toContain(PLUGIN_PATH);
    expect(withPlugin).not.toContain("brand-guidelines");
  });

  it("is byte-identical across the old 9-argument call and the new 10-argument call", () => {
    const nineArgs = buildOptions(
      noopHook,
      noopCanUseTool,
      noopWriteContext,
      undefined,
      undefined,
      ["all-hands"],
      null,
      undefined,
      undefined,
    );
    expect(serialize(build(undefined))).toBe(serialize(nineArgs));
  });
});

describe("buildOptions with SKILLS_ENABLED on", () => {
  beforeEach(() => {
    process.env.SKILLS_ENABLED = "1";
  });

  it("passes the materialized directory as a local plugin", () => {
    const opts = build(materialized());
    expect(opts.plugins).toEqual([{ type: "local", path: PLUGIN_PATH }]);
  });

  it("passes the resolved slugs as the SDK's own skills allow-list", () => {
    // sdk.d.ts:1881. The SDK hides unlisted skills from the model's listing and
    // rejects them at the Skill tool, so this is a third enforcement point that
    // does not depend on this app's gate at all.
    const opts = build(materialized());
    expect(opts.skills).toEqual(SLUGS);
  });

  it("hands the SDK a copy of the slugs, not the session's own array", () => {
    const plugin = materialized();
    const opts = build(plugin);
    expect(opts.skills).not.toBe(plugin.slugs);
  });

  it("adds the plugins and skills keys and nothing else", () => {
    const withPlugin: Record<string, unknown> = { ...build(materialized()) };
    expect(Object.keys(withPlugin)).toContain("plugins");
    expect(Object.keys(withPlugin)).toContain("skills");
    delete withPlugin.plugins;
    delete withPlugin.skills;
    delete withPlugin.mcpServers;
    const bare: Record<string, unknown> = { ...build() };
    delete bare.mcpServers;
    const replacer = (_k: string, v: unknown) => (typeof v === "function" ? "[function]" : v);
    expect(JSON.stringify(withPlugin, replacer)).toBe(JSON.stringify(bare, replacer));
  });

  it("omits both keys when nothing was materialized (null materializer)", () => {
    for (const nothing of [undefined, null]) {
      const opts = build(nothing);
      expect("plugins" in opts).toBe(false);
      expect("skills" in opts).toBe(false);
      expect(Object.keys(opts)).toEqual(KEYS_BEFORE_SPEC_34);
    }
  });

  it("omits both keys for an empty path or an empty slug list", () => {
    expect("plugins" in build({ pluginPath: "", slugs: SLUGS })).toBe(false);
    // Never `skills: []`, which would mean something different to the SDK than
    // an omitted key does.
    const emptySlugs = build({ pluginPath: PLUGIN_PATH, slugs: [] });
    expect("skills" in emptySlugs).toBe(false);
    expect("plugins" in emptySlugs).toBe(false);
  });
});
