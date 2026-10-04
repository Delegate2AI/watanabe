import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";
import { createAuthoredSkill, mayEditEntry } from "@/lib/skills/authored";
import { parseSkillManifest } from "@/lib/skills/authored-manifest";
import { authorGroups } from "@/lib/skills/authors";
import { isSkillsEnabled } from "@/lib/skills/config";
import { skillDirFor } from "@/lib/skills/install-store";
import { loadSkillRegistry } from "@/lib/skills/registry";
import { SKILL_MANIFEST } from "@/lib/skills/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTHORED_BODY_BYTES = 256_000;
const MAX_TITLE_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_BODY_CHARS = 100_000;

const createSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  body: z.string().min(1).max(MAX_BODY_CHARS),
  groups: z.array(z.string()),
});

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");

  const email = auth.identity.email;
  const admin = can(email, "manageAccess");
  const grantGroups = authorGroups(email);
  if (!admin && grantGroups.length === 0) return fail("needs_role");

  try {
    const registry = loadSkillRegistry();
    const authored = registry.entries.filter((entry) => entry.source.type === "authored");
    const visible = authored.filter((entry) => mayEditEntry(email, admin, entry));
    const skills = visible.map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      description: readDescription(entry.slug),
      groups: entry.groups,
      rev: entry.source.type === "authored" ? entry.source.rev : "",
    }));
    return Response.json({ skills, grantGroups });
  } catch (error) {
    log.error("authored skills list failed", {
      route: "GET /api/skills/authored",
      owner: email,
      err: describe(error),
    });
    return fail("internal");
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");

  const email = auth.identity.email;
  if (!can(email, "manageAccess") && authorGroups(email).length === 0) return fail("needs_role");

  const read = await readCappedBody(request, MAX_AUTHORED_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === "unreadable") return fail("invalid_request", { detail: "body" });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  try {
    const result = await createAuthoredSkill({
      actorEmail: auth.identity.email,
      title: parsed.data.title,
      description: parsed.data.description,
      body: parsed.data.body,
      groups: parsed.data.groups,
    });
    if (!result.ok) return authoredRefusal(result.error);
    return Response.json({ slug: result.slug });
  } catch (error) {
    log.error("authored skill create failed", {
      route: "POST /api/skills/authored",
      owner: auth.identity.email,
      err: describe(error),
    });
    return fail("internal");
  }
}

function readDescription(slug: string): string {
  try {
    const raw = readFileSync(path.join(skillDirFor(slug), SKILL_MANIFEST), "utf8");
    const parsed = parseSkillManifest(raw);
    return parsed.ok ? parsed.description : "";
  } catch {
    return "";
  }
}

function authoredRefusal(error: string): Response {
  if (error === "forbidden") return fail("needs_role");
  if (error === "invalid groups") return fail("invalid_request", { detail: "groups" });
  if (error === "invalid slug") return fail("invalid_request", { detail: "title" });
  if (error === "slug already taken") return fail("conflict");
  if (error === "an authored skill cannot carry scripts") return fail("invalid_request", { detail: "body" });
  return fail("internal");
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}
