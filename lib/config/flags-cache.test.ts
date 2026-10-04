import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cost half of the overrides cache, which the temp-dir tests in
 * flags.test.ts cannot see: `isFlagEnabled` runs on the per-tool-call
 * permission gate, so revalidating the cache must cost one stat and must NOT
 * re-read or re-parse the file until its stamp actually moves.
 *
 * node:fs is faked rather than driven through a temp directory precisely so the
 * two syscalls can be counted separately.
 */

const fake = vi.hoisted(() => {
  const state = {
    reads: 0,
    stats: 0,
    /** null means the file does not exist. */
    file: null as { body: string; mtimeMs: number; size: number } | null,
  };
  return {
    state,
    write(body: string, mtimeMs: number) {
      state.file = { body, mtimeMs, size: body.length };
    },
    remove() {
      state.file = null;
    },
    reset() {
      state.reads = 0;
      state.stats = 0;
      state.file = null;
    },
  };
});

vi.mock("node:fs", () => ({
  statSync: () => {
    fake.state.stats += 1;
    if (!fake.state.file) throw new Error("ENOENT");
    return { mtimeMs: fake.state.file.mtimeMs, size: fake.state.file.size };
  },
  readFileSync: () => {
    fake.state.reads += 1;
    if (!fake.state.file) throw new Error("ENOENT");
    return fake.state.file.body;
  },
}));

vi.mock("@/lib/memory/config", () => ({
  memoryWorktreeDir: () => "/fake/worktree",
}));

const { invalidateFlagOverridesCache, isFlagEnabled } = await import("./flags");

beforeEach(() => {
  fake.reset();
  invalidateFlagOverridesCache();
  delete process.env.MEMORY_ENABLED;
});

describe("overrides cache cost", () => {
  it("reads the file once and then stats only, while the stamp holds", () => {
    fake.write("flags:\n  MEMORY_ENABLED: true\n", 1_000);

    for (let call = 0; call < 25; call += 1) {
      expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);
    }

    expect(fake.state.reads).toBe(1);
    expect(fake.state.stats).toBe(25);
  });

  it("re-reads exactly once when the stamp moves", () => {
    fake.write("flags:\n  MEMORY_ENABLED: true\n", 1_000);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    fake.write("flags:\n  MEMORY_ENABLED: false\n", 2_000);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);

    expect(fake.state.reads).toBe(2);
  });

  it("notices a same-mtime rewrite that changed the file's size", () => {
    // Timestamp granularity is coarser than a fast rewrite, so size is the
    // second discriminator. It narrows the window rather than closing it.
    fake.write("flags:\n  MEMORY_ENABLED: true\n", 1_000);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    fake.write("flags:\n  MEMORY_ENABLED: false\n  INDEX_ENABLED: true\n", 1_000);

    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
    expect(isFlagEnabled("INDEX_ENABLED")).toBe(true);
  });

  it("does not re-read while the file stays absent", () => {
    for (let call = 0; call < 10; call += 1) {
      expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
    }

    // The absent state is cached as well: a workspace where no admin has ever
    // touched a flag is the common case, and it must not pay a read per check.
    expect(fake.state.reads).toBe(1);
    expect(fake.state.stats).toBe(10);
  });

  it("notices the file appearing after having been absent", () => {
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);

    fake.write("flags:\n  MEMORY_ENABLED: true\n", 3_000);

    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);
  });

  it("notices the file being removed after having been read", () => {
    fake.write("flags:\n  MEMORY_ENABLED: true\n", 1_000);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    fake.remove();

    // No override any more, so the answer falls back to the environment.
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
    process.env.MEMORY_ENABLED = "1";
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);
  });
});
