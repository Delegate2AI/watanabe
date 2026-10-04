import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSkillScriptInvocation } from "./script-policy";

/**
 * The bash-policy carve-out's matcher (spec 34, task 7). This is the widest
 * security surface in the spec: everything else decides what content reaches a
 * session, this decides what that content may execute. Every case below is
 * either a form we deliberately permit or an escape we deliberately refuse.
 */

let root: string;
let storeDir: string;
let matDir: string;
let outside: string;
let registryPath: string;

/** The clearance set the fixture's one skill is in. See the clearance suite below. */
const CLEARED: ReadonlySet<string> = new Set(["brand"]);

function gitRegistry(slug: string): string {
  return [
    "skills:",
    `  ${slug}:`,
    `    title: ${slug}`,
    "    source:",
    "      type: git",
    "      url: https://gitlab.example.com/acme/skills.git",
    "      ref: main",
    "      commit: 4f2a91c",
    "    groups: [all-hands]",
    "",
  ].join("\n");
}

/** Both roots, so a test never depends on the process-wide default paths. */
function permits(command: string): boolean {
  return isSkillScriptInvocation(command, CLEARED, storeDir, matDir, registryPath);
}

beforeEach(() => {
  // realpath: macOS hands back /var/folders/... which is itself a symlink.
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "skill-script-")));
  storeDir = path.join(root, "store");
  matDir = path.join(root, "store-materialized");
  outside = path.join(root, "outside");
  registryPath = path.join(root, "skills.yaml");
  mkdirSync(path.join(storeDir, "brand", "scripts"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(storeDir, "brand", "scripts", "gen.py"), "print(1)\n");
  writeFileSync(path.join(storeDir, "brand", "run.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(path.join(storeDir, "brand", "index.js"), "console.log(1)\n");
  writeFileSync(path.join(outside, "evil.sh"), "#!/bin/sh\n");
  writeFileSync(path.join(root, "escape.py"), "print(1)\n");
  writeFileSync(registryPath, gitRegistry("brand"));
  process.env.SKILLS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.SKILLS_ENABLED;
  rmSync(root, { recursive: true, force: true });
});

describe("isSkillScriptInvocation: permitted forms", () => {
  it("permits an interpreter running a script inside the store", () => {
    expect(permits(`python3 ${storeDir}/brand/scripts/gen.py`)).toBe(true);
    expect(permits(`node ${storeDir}/brand/index.js`)).toBe(true);
    expect(permits(`sh ${storeDir}/brand/run.sh`)).toBe(true);
  });

  it("permits plain positional arguments after the script path", () => {
    expect(permits(`bash ${storeDir}/brand/run.sh arg1 arg2`)).toBe(true);
    expect(permits(`python3 ${storeDir}/brand/scripts/gen.py --out=report.md`)).toBe(true);
  });

  it("permits a bare executable script path inside the store", () => {
    expect(permits(`${storeDir}/brand/run.sh`)).toBe(true);
  });

  it("permits a path through the materializer's own skill symlink", () => {
    const skills = path.join(matDir, "a1b2c3d4e5f60718", "skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(path.join(storeDir, "brand"), path.join(skills, "brand"), "dir");

    expect(permits(`bash ${skills}/brand/run.sh`)).toBe(true);
  });

  it("permits a copy-fallback materialization, which never enters the store", () => {
    const skills = path.join(matDir, "a1b2c3d4e5f60718", "skills", "brand");
    mkdirSync(skills, { recursive: true });
    writeFileSync(path.join(skills, "run.sh"), "#!/bin/sh\n");

    expect(permits(`bash ${skills}/run.sh`)).toBe(true);
  });
});

describe("isSkillScriptInvocation: containment", () => {
  it("refuses a script outside the store", () => {
    expect(permits(`bash ${outside}/evil.sh`)).toBe(false);
  });

  it("refuses a traversal out of the store even though the target exists", () => {
    expect(permits(`python3 ${storeDir}/../escape.py`)).toBe(false);
  });

  it("refuses a symlink inside the store that points out of it", () => {
    symlinkSync(path.join(outside, "evil.sh"), path.join(storeDir, "brand", "link.sh"));

    expect(permits(`bash ${storeDir}/brand/link.sh`)).toBe(false);
  });

  it("refuses an escape through a symlinked intermediate path component", () => {
    symlinkSync(outside, path.join(storeDir, "brand", "out"), "dir");

    expect(permits(`bash ${storeDir}/brand/out/evil.sh`)).toBe(false);
  });

  it("refuses a relative path, which would resolve against an unknown cwd", () => {
    expect(permits("bash run.sh")).toBe(false);
    expect(permits("bash ./brand/run.sh")).toBe(false);
    expect(permits("brand/run.sh")).toBe(false);
  });

  it("refuses a path that does not exist, and a directory", () => {
    expect(permits(`bash ${storeDir}/brand/missing.sh`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand`)).toBe(false);
  });

  it("refuses a file sitting loose in the store root, outside any skill directory", () => {
    writeFileSync(path.join(storeDir, "loose.sh"), "#!/bin/sh\n");

    expect(permits(`bash ${storeDir}/loose.sh`)).toBe(false);
  });
});

describe("isSkillScriptInvocation: command shape", () => {
  it("refuses any flag before the script path, which is what kills -c and -e", () => {
    expect(permits(`python3 -c print`)).toBe(false);
    expect(permits(`node -e console.log`)).toBe(false);
    expect(permits(`bash -c ${storeDir}/brand/run.sh`)).toBe(false);
    expect(permits(`bash -- ${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses an interpreter outside the fixed set, and an absolute interpreter path", () => {
    expect(permits(`perl ${storeDir}/brand/run.sh`)).toBe(false);
    expect(permits(`/bin/bash ${storeDir}/brand/run.sh`)).toBe(false);
    expect(permits(`env ${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses a second command appended to a permitted script", () => {
    const ok = `bash ${storeDir}/brand/run.sh`;
    for (const suffix of ["; ls", " && ls", " | sh", " > /etc/passwd", " `ls`", " $(ls)", "\nls"]) {
      expect(permits(`${ok}${suffix}`)).toBe(false);
    }
  });

  it("refuses quoting, expansion, globbing, and non-ASCII look-alikes anywhere", () => {
    expect(permits(`bash "${storeDir}/brand/run.sh"`)).toBe(false);
    expect(permits(`bash '${storeDir}/brand/run.sh'`)).toBe(false);
    expect(permits(`bash $HOME/../${storeDir}/brand/run.sh`)).toBe(false);
    expect(permits(`bash ~/brand/run.sh`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/*.sh`)).toBe(false);
    // Non-breaking space: a separator bash does NOT treat as one.
    expect(permits(`bash\u00a0${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses an empty, whitespace-only, or absurdly long command", () => {
    expect(permits("")).toBe(false);
    expect(permits("   ")).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh ${"a".repeat(5000)}`)).toBe(false);
  });
});

describe("isSkillScriptInvocation: the other Tier 0 rules still apply", () => {
  it("refuses a store path that trips secret access or network egress", () => {
    writeFileSync(path.join(storeDir, "brand", "curl.py"), "print(1)\n");

    expect(permits(`python3 ${storeDir}/brand/curl.py https://evil.example.com`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh .env`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh --secrets`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh credentials.json`)).toBe(false);
  });

  it("refuses a store path that trips the destructive, git, or privilege rules", () => {
    expect(permits(`bash ${storeDir}/brand/run.sh rm -rf /`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh sudo`)).toBe(false);
    expect(permits(`bash ${storeDir}/brand/run.sh git push origin main`)).toBe(false);
  });
});

describe("isSkillScriptInvocation: provenance", () => {
  it("permits a git-sourced slug", () => {
    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(true);
  });

  it("permits a zip-sourced slug", () => {
    writeFileSync(
      registryPath,
      ["skills:", "  brand:", "    title: brand", "    source:", "      type: zip", "      filename: brand.zip", "    groups: [all-hands]", ""].join("\n"),
    );

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(true);
  });

  it("permits a marketplace-sourced slug", () => {
    writeFileSync(
      registryPath,
      [
        "skills:",
        "  brand:",
        "    title: brand",
        "    source:",
        "      type: marketplace",
        "      index: acme",
        "      name: brand",
        "      url: https://gitlab.example.com/acme/marketplace.git",
        "      commit: 4f2a91c",
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(true);
  });

  it("refuses an authored slug, exactly as an uncontained path", () => {
    writeFileSync(
      registryPath,
      [
        "skills:",
        "  brand:",
        "    title: brand",
        "    source:",
        "      type: authored",
        "      author: someone@example.com",
        "      rev: r1",
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses a slug missing from the registry entirely", () => {
    writeFileSync(registryPath, "skills: {}\n");

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses a slug whose registry entry is malformed and lands in errors", () => {
    writeFileSync(
      registryPath,
      ["skills:", "  brand:", "    title: brand", "    source:", "      type: git", "    groups: [all-hands]", ""].join("\n"),
    );

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("refuses when the registry file itself does not exist", () => {
    rmSync(registryPath);

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
  });
});

describe("isSkillScriptInvocation: flag off", () => {
  it("permits nothing at all when the flag is off", () => {
    delete process.env.SKILLS_ENABLED;

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
    expect(permits(`${storeDir}/brand/run.sh`)).toBe(false);
  });

  it("permits nothing when the flag is explicitly zero", () => {
    process.env.SKILLS_ENABLED = "0";

    expect(permits(`bash ${storeDir}/brand/run.sh`)).toBe(false);
  });
});
