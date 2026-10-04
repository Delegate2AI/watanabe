import { existsSync } from "node:fs";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_BRANCH, memoryWorktreeDir } from "@/lib/memory/config";
import { ensureMemoryWorktree, originUrl, withMemoryLock } from "@/lib/memory/repo-memory";
import { run } from "@/lib/repo";
import { can } from "@/lib/authority/roles";
import { BOT_COMMITTER_NAME, BOT_COMMITTER_EMAIL, redact } from "./repo-write";

/**
 * The private access write path: the small set of files on the
 * portal-memory ref that describe who is in which group, who holds which role,
 * which flags are overridden, and (since the people directory) what people are
 * called. Split out of repo-write.ts because it is a self-contained concern
 * with its own allow-list and its own path-safety rules, and because that file
 * had grown past the point where either was easy to find.
 */
const PRIVATE_ACCESS_PATHS = new Set([
  "access/groups.yaml",
  "access/roles.yaml",
  "access/flags.yaml",
  "access/people.yaml",
  "access/aliases.yaml",
  "access/connectors.yaml",
  "access/skills.yaml",
  "access/design-guide.md",
]);

export type PrivateAccessFiles = Partial<Record<
  | "access/groups.yaml"
  | "access/roles.yaml"
  | "access/flags.yaml"
  | "access/people.yaml"
  | "access/aliases.yaml"
  | "access/connectors.yaml"
  | "access/skills.yaml"
  | "access/design-guide.md",
  string
>>;

export interface PrivateAccessCommitOptions {
  message: string;
  authorName: string;
  authorEmail: string;
  onBehalfOf?: { name: string; email: string };
}

export type PrivateAccessCommitResult = { ok: true } | { ok: false; error: string };

export type PrivateAccessMutation = () => PrivateAccessFiles | { error: string };

function allowedEntries(files: PrivateAccessFiles): Array<[string, string]> | null {
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.some(([relative]) => !PRIVATE_ACCESS_PATHS.has(relative))) return null;
  return entries as Array<[string, string]>;
}

function isRefusal(value: PrivateAccessFiles | { error: string }): value is { error: string } {
  return typeof (value as { error?: unknown }).error === "string";
}

export async function commitPrivateAccess(
  filesOrMutation: PrivateAccessFiles | PrivateAccessMutation,
  options: PrivateAccessCommitOptions,
): Promise<PrivateAccessCommitResult> {
  if (!can(options.authorEmail, "manageAccess")) return { ok: false, error: "forbidden" };
  const attributed = options.onBehalfOf ?? { name: options.authorName, email: options.authorEmail };
  const mutation = typeof filesOrMutation === "function" ? filesOrMutation : null;
  const prepared = mutation ? null : allowedEntries(filesOrMutation as PrivateAccessFiles);
  if (!mutation && !prepared) return { ok: false, error: "invalid private access path" };

  return withMemoryLock(async () => {
    const dir = memoryWorktreeDir();
    let baseSha = "";
    try {
      if (!existsSync(path.join(dir, ".git")) && !(await ensureMemoryWorktree())) {
        return { ok: false, error: "private access checkout unavailable" };
      }
      const remote = originUrl();
      await run("git", ["-C", dir, "fetch", remote, MEMORY_BRANCH]);
      await run("git", ["-C", dir, "rebase", "FETCH_HEAD"]);
      baseSha = await run("git", ["-C", dir, "rev-parse", "HEAD"]);
      const dirty = await run("git", ["-C", dir, "status", "--porcelain", "--", "access"]);
      if (dirty) return { ok: false, error: "private access checkout has pending changes" };
      const built = mutation ? mutation() : null;
      if (built && isRefusal(built)) return { ok: false, error: built.error };
      const entries = built ? allowedEntries(built) : prepared;
      if (!entries) return { ok: false, error: "invalid private access path" };

      await mkdir(path.join(dir, "access"), { recursive: true });
      for (const [relative, content] of entries) {
        const target = path.join(dir, relative);
        // The allow-list checks the requested name, not where that name leads.
        // A symlink committed to the private ref as access/<file>.yaml would
        // send this write anywhere on disk, and git would still call the tree
        // clean because the link text never changed. Refuse to follow one, and
        // refuse anything whose resolved path leaves the checkout. This matters
        // more since the people directory: self-population means an ordinary
        // sign-in reaches this code, where it used to take an admin action.
        // Both sides get resolved: on macOS the checkout typically sits under
        // /var, which is itself a symlink to /private/var, so comparing a
        // resolved child against an unresolved root rejects every legitimate
        // write. Same trap realOrResolved() in repo-write.ts documents.
        const root = await realpath(dir);
        const parent = await realpath(path.dirname(target));
        const rel = path.relative(root, parent);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          return { ok: false, error: "invalid private access path" };
        }
        const existing = await lstat(target).catch(() => null);
        if (existing?.isSymbolicLink()) {
          return { ok: false, error: "invalid private access path" };
        }
        await writeFile(target, content, "utf8");
      }
      const paths = entries.map(([relative]) => relative);
      await run("git", ["-C", dir, "add", "--", ...paths]);
      const staged = await run("git", ["-C", dir, "diff", "--cached", "--name-only", "--", ...paths]);
      if (!staged) return { ok: true };
      await run("git", [
        "-C",
        dir,
        "-c",
        `user.name=${BOT_COMMITTER_NAME}`,
        "-c",
        `user.email=${BOT_COMMITTER_EMAIL}`,
        "commit",
        "-m",
        options.message,
        "--author",
        `${attributed.name} <${attributed.email}>`,
        "--",
        ...paths,
      ]);
      await run("git", ["-C", dir, "push", remote, `HEAD:${MEMORY_BRANCH}`]);
      return { ok: true };
    } catch (error) {
      await run("git", ["-C", dir, "rebase", "--abort"]).catch(() => {});
      if (baseSha) await run("git", ["-C", dir, "reset", "--hard", baseSha]).catch(() => {});
      return { ok: false, error: redact(error instanceof Error ? error.message : String(error), process.env.REPO_WRITE_TOKEN ?? "") };
    }
  });
}
