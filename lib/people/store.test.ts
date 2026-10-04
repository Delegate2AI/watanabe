import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { loadPeople, upsertPerson } from "./store";

let root: string;
let peoplePath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "people-store-"));
  peoplePath = path.join(root, "people.yaml");
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("loadPeople", () => {
  it("parses a valid directory and lower-cases its keys", () => {
    writeFileSync(
      peoplePath,
      "people:\n  Maria.Chen@example.com:\n    name: Maria Chen\n    title: Research Lead\n    source: manual\n",
    );

    expect(loadPeople(peoplePath)).toEqual({
      "maria.chen@example.com": { name: "Maria Chen", title: "Research Lead", source: "manual" },
    });
  });

  it("defaults a row with no source to idp", () => {
    writeFileSync(peoplePath, "people:\n  a@example.com:\n    name: Ada\n");

    expect(loadPeople(peoplePath)).toEqual({ "a@example.com": { name: "Ada", source: "idp" } });
  });

  it("returns an empty directory and logs when yaml is malformed", () => {
    writeFileSync(peoplePath, "people: [not: valid");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadPeople(peoplePath)).toEqual({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining("people"));
  });

  it("returns an empty directory without logging when the file is missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadPeople(path.join(root, "absent.yaml"))).toEqual({});
    expect(error).not.toHaveBeenCalled();
  });

  it("drops a row missing a name rather than failing the whole file", () => {
    writeFileSync(
      peoplePath,
      "people:\n  broken@example.com:\n    title: No Name\n  ok@example.com:\n    name: Ok Person\n",
    );

    expect(loadPeople(peoplePath)).toEqual({ "ok@example.com": { name: "Ok Person", source: "idp" } });
  });

  it("drops a key that is not an email", () => {
    writeFileSync(peoplePath, "people:\n  not-an-email:\n    name: Nope\n");

    expect(loadPeople(peoplePath)).toEqual({});
  });
});

describe("upsertPerson", () => {
  function committedYaml(): string {
    const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
    return files["access/people.yaml"];
  }

  it("commits a new row to access/people.yaml", async () => {
    await upsertPerson("Ada@example.com", { name: "Ada Lovelace", source: "idp" }, { filePath: peoplePath });

    expect(commitPrivateAccessMock).toHaveBeenCalledTimes(1);
    expect(committedYaml()).toContain("ada@example.com");
    expect(committedYaml()).toContain("Ada Lovelace");
  });

  it("does not let an idp upsert overwrite a manual record", async () => {
    writeFileSync(peoplePath, "people:\n  ada@example.com:\n    name: Ada L\n    source: manual\n");

    await upsertPerson("ada@example.com", { name: "Ada Lovelace", source: "idp" }, { filePath: peoplePath });

    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("lets a manual upsert overwrite an idp record", async () => {
    writeFileSync(peoplePath, "people:\n  ada@example.com:\n    name: ada\n    source: idp\n");

    await upsertPerson("ada@example.com", { name: "Ada Lovelace", source: "manual" }, { filePath: peoplePath });

    expect(committedYaml()).toContain("Ada Lovelace");
    expect(committedYaml()).toContain("manual");
  });

  it("does not commit when the stored record already matches", async () => {
    writeFileSync(peoplePath, "people:\n  ada@example.com:\n    name: Ada Lovelace\n    source: idp\n");

    await upsertPerson("ada@example.com", { name: "Ada Lovelace", source: "idp" }, { filePath: peoplePath });

    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("preserves the other rows and keeps keys sorted", async () => {
    writeFileSync(
      peoplePath,
      "people:\n  zoe@example.com:\n    name: Zoe\n    source: idp\n",
    );

    await upsertPerson("ada@example.com", { name: "Ada", source: "idp" }, { filePath: peoplePath });

    expect(committedYaml().indexOf("ada@example.com")).toBeLessThan(
      committedYaml().indexOf("zoe@example.com"),
    );
  });

  it("ignores an invalid email or an empty name without committing", async () => {
    await upsertPerson("not-an-email", { name: "Nope", source: "idp" }, { filePath: peoplePath });
    await upsertPerson("ada@example.com", { name: "   ", source: "idp" }, { filePath: peoplePath });

    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("logs and swallows a failed commit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await expect(
      upsertPerson("ada@example.com", { name: "Ada", source: "idp" }, { filePath: peoplePath }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ada@example.com"));
  });

  it("logs and swallows a rejected commit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    commitPrivateAccessMock.mockRejectedValue(new Error("network down"));

    await expect(
      upsertPerson("ada@example.com", { name: "Ada", source: "idp" }, { filePath: peoplePath }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });
});
