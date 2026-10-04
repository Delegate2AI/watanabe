import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Groups } from "./groups";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { loadAliasMap, serializeAliasMap, writeAlias } from "./aliases-store";

const CANONICAL = "maria.chen@example.com";
const ALIAS = "maria.personal@example.test";
const GROUPS: Groups = { "all-hands": [CANONICAL, "sam@example.com"], exec: [CANONICAL] };

let root: string;
let aliasesPath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "alias-store-"));
  aliasesPath = path.join(root, "aliases.yaml");
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** The content the commit mock was handed for access/aliases.yaml. */
function committedYaml(): string {
  const [files] = commitPrivateAccessMock.mock.calls[0] as [Record<string, string>];
  return files["access/aliases.yaml"];
}

describe("loadAliasMap", () => {
  it("reads the forward map and lower-cases both sides", () => {
    writeFileSync(aliasesPath, `aliases:\n  Maria.Chen@example.com:\n    - Maria.Personal@example.test\n`);

    expect(loadAliasMap(aliasesPath)).toEqual({ [CANONICAL]: [ALIAS] });
  });

  it("is empty for a missing file, which is a fresh install and not an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadAliasMap(path.join(root, "nope.yaml"))).toEqual({});
    expect(error).not.toHaveBeenCalled();
  });

  it("logs and degrades to an empty map when the file is malformed", () => {
    writeFileSync(aliasesPath, "aliases: [not: valid");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadAliasMap(aliasesPath)).toEqual({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining("alias map"));
  });

  it("drops one malformed row without costing the others theirs", () => {
    writeFileSync(
      aliasesPath,
      `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n  not-an-email:\n    - x@example.com\n  sam@example.com: "a string, not a list"\n`,
    );

    expect(loadAliasMap(aliasesPath)).toEqual({ [CANONICAL]: [ALIAS] });
  });

  it("drops a non-email alias and de-duplicates the rest", () => {
    writeFileSync(
      aliasesPath,
      `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n    - ${ALIAS}\n    - nonsense\n`,
    );

    expect(loadAliasMap(aliasesPath)).toEqual({ [CANONICAL]: [ALIAS] });
  });
});

describe("serializeAliasMap", () => {
  it("sorts canonical keys and each alias list", () => {
    const yaml = serializeAliasMap({
      "zoe@example.com": ["z.b@example.test", "z.a@example.test"],
      "amy@example.com": ["a@example.test"],
    });

    expect(yaml).toBe(
      "aliases:\n  amy@example.com:\n    - a@example.test\n  zoe@example.com:\n    - z.a@example.test\n    - z.b@example.test\n",
    );
  });

  it("drops a canonical whose list has gone empty rather than leaving a bare key", () => {
    expect(serializeAliasMap({ [CANONICAL]: [] })).toBe("aliases: {}\n");
  });
});

describe("writeAlias addAlias", () => {
  it("commits the new alias and reports the person's resulting list", async () => {
    const result = await writeAlias(
      { verb: "addAlias", email: "Maria.Chen@example.com", alias: " Maria.Personal@example.test " },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: true, aliases: [ALIAS] });
    expect(committedYaml()).toBe(`aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n`);
    expect(commitPrivateAccessMock).toHaveBeenCalledWith(expect.anything(), {
      authorName: "admin@example.com",
      authorEmail: "admin@example.com",
      message: `chore(access): add alias ${ALIAS} for ${CANONICAL}`,
    });
  });

  it("keeps an existing person's other aliases and stays sorted", async () => {
    writeFileSync(aliasesPath, `aliases:\n  ${CANONICAL}:\n    - z@example.test\n`);

    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: "a@example.test" },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: true, aliases: ["a@example.test", "z@example.test"] });
    expect(committedYaml()).toContain("    - a@example.test\n    - z@example.test");
  });

  it("treats a repeat of an alias the person already has as an idempotent success", async () => {
    writeFileSync(aliasesPath, `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n`);

    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: true, aliases: [ALIAS] });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a canonical who is not in the roster", async () => {
    const result = await writeAlias(
      { verb: "addAlias", email: "stranger@example.com", alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an alias that is a group member, which would take that member's own clearance away", async () => {
    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: "sam@example.com" },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "taken" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an alias that is already a canonical key, which the reader would drop anyway", async () => {
    writeFileSync(aliasesPath, `aliases:\n  other@example.test:\n    - x@example.test\n`);

    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: "other@example.test" },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "taken" });
  });

  it("refuses an alias already claimed by a different person", async () => {
    writeFileSync(aliasesPath, `aliases:\n  sam@example.com:\n    - ${ALIAS}\n`);

    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "taken" });
  });

  it("refuses an alias equal to the canonical itself", async () => {
    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: CANONICAL },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "self" });
  });

  it("refuses a malformed address on either side", async () => {
    await expect(writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: "not-an-email" },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    )).resolves.toEqual({ ok: false, reason: "invalid" });

    await expect(writeAlias(
      { verb: "addAlias", email: "not-an-email", alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    )).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a refused commit rather than swallowing it", async () => {
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "private access checkout has pending changes" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("alias write refused"));
  });
});

describe("writeAlias removeAlias", () => {
  it("removes the alias and drops the canonical once its list is empty", async () => {
    writeFileSync(aliasesPath, `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n`);

    const result = await writeAlias(
      { verb: "removeAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: true, aliases: [] });
    expect(committedYaml()).toBe("aliases: {}\n");
    expect(commitPrivateAccessMock.mock.calls[0][1]).toMatchObject({
      message: `chore(access): remove alias ${ALIAS} from ${CANONICAL}`,
    });
  });

  it("keeps the canonical when other aliases remain", async () => {
    writeFileSync(aliasesPath, `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n    - z@example.test\n`);

    const result = await writeAlias(
      { verb: "removeAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: true, aliases: ["z@example.test"] });
    expect(committedYaml()).toBe(`aliases:\n  ${CANONICAL}:\n    - z@example.test\n`);
  });

  it("refuses to remove an alias the person does not have", async () => {
    const result = await writeAlias(
      { verb: "removeAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});

describe("the committed file", () => {
  it("round-trips through loadAliasMap", async () => {
    await writeAlias(
      { verb: "addAlias", email: CANONICAL, alias: ALIAS },
      "admin@example.com",
      { filePath: aliasesPath, groups: GROUPS },
    );
    writeFileSync(aliasesPath, committedYaml());

    expect(loadAliasMap(aliasesPath)).toEqual({ [CANONICAL]: [ALIAS] });
  });
});
