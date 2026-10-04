import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSkillsEnabled,
  skillsFilePath,
  skillsMaterializedDir,
  skillsStoreDir,
} from "./config";

afterEach(() => {
  delete process.env.SKILLS_ENABLED;
  delete process.env.PORTAL_SKILLS_DIR;
});

describe("isSkillsEnabled", () => {
  it("is false by default", () => {
    expect(isSkillsEnabled()).toBe(false);
  });

  it("is true when SKILLS_ENABLED=1", () => {
    process.env.SKILLS_ENABLED = "1";
    expect(isSkillsEnabled()).toBe(true);
  });
});

describe("skillsStoreDir", () => {
  it("defaults to .data/skills under the process cwd", () => {
    expect(skillsStoreDir()).toBe(path.resolve(process.cwd(), ".data", "skills"));
  });

  it("honours PORTAL_SKILLS_DIR", () => {
    process.env.PORTAL_SKILLS_DIR = "/srv/portal/skills";
    expect(skillsStoreDir()).toBe("/srv/portal/skills");
  });
});

describe("skillsMaterializedDir", () => {
  it("is a sibling of the store dir", () => {
    expect(skillsMaterializedDir()).toBe(
      path.resolve(process.cwd(), ".data", "skills-materialized"),
    );
  });

  it("follows PORTAL_SKILLS_DIR so both roots stay on one volume", () => {
    process.env.PORTAL_SKILLS_DIR = "/srv/portal/skills";
    expect(skillsMaterializedDir()).toBe("/srv/portal/skills-materialized");
  });
});

describe("skillsFilePath", () => {
  it("sits next to the other access/ files in the memory worktree", () => {
    expect(skillsFilePath().endsWith(path.join("access", "skills.yaml"))).toBe(true);
  });
});
