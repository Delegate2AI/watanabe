import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { readVisibility } from "@/lib/authority/visibility";
import { markdownFiles, setNoteVisibility } from "@/lib/authority/set-visibility";
import { isFlagEnabled } from "@/lib/config/flags";
import { fail } from "@/lib/errors/codes";
import { unfilteredVaultRoot } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const groupName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .refine((name) => !RESERVED_KEYS.has(name), { message: "reserved group name" });
const bodySchema = z
  .object({ path: z.string().min(1), visibility: z.array(groupName).min(1) })
  .strict();

function forbidden(): Response {
  return fail("needs_role");
}

/**
 * `setNoteVisibility` reports why it refused. Translate that into a code rather
 * than forwarding the sentence: the writer's vocabulary is an internal detail,
 * and one of its reasons used to name an environment variable.
 */
function refusal(reason: string | undefined): Response {
  if (reason === "forbidden") return fail("needs_role");
  if (reason === "write_unavailable") return fail("write_unavailable");
  if (reason === "review_unavailable") return fail("review_unavailable");
  if (reason === "feature disabled" || reason === "path not found") return fail("not_found");
  if (reason === "visibility submission failed" || reason === "visibility update failed") {
    return fail("internal");
  }
  return fail("invalid_request", { detail: "path" });
}

/**
 * A folder has no single visibility. Aggregate across every `.md` under it: the
 * checked state is the groups common to all files (so a uniformly-cleared folder
 * shows exactly its shared clearance), and `mixed` flags that files differ, so
 * the modal can warn that saving overwrites them all. Unparseable files are
 * skipped, matching how a bulk set-visibility write skips them.
 */
function folderVisibility(dir: string): { visibility: string[]; mixed: boolean } {
  const sets = markdownFiles(dir)
    .map((file) => {
      try {
        return readVisibility(readFileSync(file, "utf8"));
      } catch {
        return "unparseable" as const;
      }
    })
    .filter((value): value is string[] => value !== "unparseable")
    .map((value) => [...new Set(value)].sort());
  if (sets.length === 0) return { visibility: [], mixed: false };
  const first = JSON.stringify(sets[0]);
  const mixed = sets.some((set) => JSON.stringify(set) !== first);
  const intersection = sets.reduce((common, set) => common.filter((group) => set.includes(group)), [...sets[0]]);
  return { visibility: [...new Set(intersection)].sort(), mixed };
}

export async function POST(request: Request): Promise<Response> {
  if (!isFlagEnabled("KB_ACCESS_UI_ENABLED")) return fail("not_found");
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const result = await setNoteVisibility(parsed.data.path, parsed.data.visibility, actorEmail);
  if (!result.ok) return refusal(result.error);
  return Response.json({
    branch: result.branch,
    ...(result.mrUrl ? { mrUrl: result.mrUrl } : {}),
    count: result.count ?? 0,
    skipped: result.skipped ?? [],
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isFlagEnabled("KB_ACCESS_UI_ENABLED")) return fail("not_found");
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!can(auth.identity.email, "manageAccess")) return forbidden();

  const rel = new URL(request.url).searchParams.get("path");
  if (!rel) return fail("invalid_request", { detail: "path" });
  const stripped = rel.replace(/^docs\//, "");
  const normalized = path.posix.normalize(stripped);
  if (path.isAbsolute(stripped) || normalized.startsWith("..")) {
    return fail("invalid_request", { detail: "path" });
  }
  const vaultDir = unfilteredVaultRoot();
  const absolute = path.join(vaultDir, normalized);
  if (path.relative(vaultDir, absolute).startsWith("..")) {
    return fail("invalid_request", { detail: "path" });
  }
  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (stat?.isDirectory()) return Response.json(folderVisibility(absolute));
  try {
    const visibility = readVisibility(readFileSync(absolute, "utf8"));
    return Response.json({ visibility: visibility === "unparseable" ? [] : visibility, mixed: false });
  } catch {
    return Response.json({ visibility: [], mixed: false });
  }
}
