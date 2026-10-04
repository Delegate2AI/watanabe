/**
 * Seeds `access/groups.yaml` (clearance), `access/roles.yaml` (write
 * capability), and `access/people.yaml` (display names) into the portal-memory
 * checkout.
 *
 * Writing the files is not enough on its own: `ensureMemoryWorktree()` runs
 * `git reset --hard FETCH_HEAD` on the first write-path call, which would throw
 * loose files away. So when the checkout is a real git repo (the local bare
 * origin from MEMORY_ORIGIN_OVERRIDE), the seed is committed and pushed to the
 * `portal-memory` branch, exactly like the admin UI's own write path.
 *
 * Never throws: a missing/misconfigured origin leaves the loose files in place,
 * which is still enough for the read side (Members/Groups tabs, clearance chips).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../lib/config/load";
import { GROUPS, PEOPLE, ROLES } from "./roster";

const BRANCH = "portal-memory";

function yamlList(entries: Record<string, string[]>, key: string): string {
  const lines = [`${key}:`];
  for (const [name, members] of Object.entries(entries)) {
    if (members.length === 0) continue;
    lines.push(`  ${name}:`);
    for (const member of members) lines.push(`    - ${member}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The people directory the PEOPLE_ENABLED surfaces render through. Seeded as
 * `source: idp`, the same shape a real sign-in would write, so an admin edit in
 * /admin/access still wins over it afterwards.
 */
function peopleYaml(): string {
  const lines = ["people:"];
  for (const person of PEOPLE) {
    lines.push(`  ${person.email}:`, `    name: ${person.name}`, "    source: idp");
  }
  return `${lines.join("\n")}\n`;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function seedAccess(): { dir: string; committed: boolean } {
  const dir = path.resolve(process.cwd(), process.env.MEMORY_CHECKOUT_DIR?.trim() || ".data/memory");
  const accessDir = path.join(dir, "access");
  mkdirSync(accessDir, { recursive: true });

  writeFileSync(path.join(accessDir, "groups.yaml"), yamlList(GROUPS, "groups"));
  // roles.yaml's zod schema REQUIRES a top-level `default:`; without it the
  // whole file is silently rejected and everyone falls back to viewer.
  writeFileSync(path.join(accessDir, "roles.yaml"), `${yamlList(ROLES, "roles")}default: viewer\n`);
  writeFileSync(path.join(accessDir, "people.yaml"), peopleYaml());

  if (!existsSync(path.join(dir, ".git"))) return { dir, committed: false };

  const remote = process.env.MEMORY_ORIGIN_OVERRIDE?.trim();
  if (!remote) return { dir, committed: false };

  try {
    git(dir, ["add", "access"]);
    if (git(dir, ["diff", "--cached", "--name-only"]).trim() === "") return { dir, committed: true };
    git(dir, [
      "-c", "user.name=Portal Memory",
      "-c", `user.email=${loadConfig().git.memoryEmail}`,
      "commit", "-m", "chore(access): seed demo groups, roles, and people",
    ]);
    git(dir, ["push", remote, `HEAD:${BRANCH}`]);
    return { dir, committed: true };
  } catch (error) {
    console.warn(`  ! access yaml written but not committed: ${String(error).split("\n")[0]}`);
    return { dir, committed: false };
  }
}
