import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";
import { authoredEditGate, deleteAuthoredSkill, updateAuthoredSkill } from "@/lib/skills/authored";
import { readAuthoredSkill } from "@/lib/skills/authored-read";
import { isSkillsEnabled } from "@/lib/skills/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTHORED_BODY_BYTES = 256_000;
const MAX_TITLE_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 1024;
const MAX_BODY_CHARS = 100_000;

const updateSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS).optional(),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS).optional(),
  body: z.string().min(1).max(MAX_BODY_CHARS).optional(),
  groups: z.array(z.string()).optional(),
});

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");

  const { slug } = await context.params;

  try {
    const result = await readAuthoredSkill({ actorEmail: auth.identity.email, slug });
    if (!result.ok) return authoredRefusal(result.error);
    return Response.json(result.skill);
  } catch (error) {
    log.error("authored skill read failed", {
      route: "GET /api/skills/authored/[slug]",
      owner: auth.identity.email,
      err: describe(error),
    });
    return fail("internal");
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");

  const { slug } = await context.params;
  const gate = authoredEditGate(auth.identity.email, slug);
  if (!gate.ok) return authoredRefusal(gate.error);

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
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  try {
    const result = await updateAuthoredSkill({
      actorEmail: auth.identity.email,
      slug,
      title: parsed.data.title,
      description: parsed.data.description,
      body: parsed.data.body,
      groups: parsed.data.groups,
    });
    if (!result.ok) return authoredRefusal(result.error);
    return Response.json({ slug: result.slug });
  } catch (error) {
    log.error("authored skill update failed", {
      route: "PUT /api/skills/authored/[slug]",
      owner: auth.identity.email,
      err: describe(error),
    });
    return fail("internal");
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");

  const { slug } = await context.params;

  try {
    const result = await deleteAuthoredSkill({ actorEmail: auth.identity.email, slug });
    if (!result.ok) return authoredRefusal(result.error);
    return Response.json({ removed: true });
  } catch (error) {
    log.error("authored skill delete failed", {
      route: "DELETE /api/skills/authored/[slug]",
      owner: auth.identity.email,
      err: describe(error),
    });
    return fail("internal");
  }
}

function authoredRefusal(error: string): Response {
  if (error === "forbidden") return fail("needs_role");
  if (error === "not an authored skill") return fail("not_found");
  if (error === "invalid groups") return fail("invalid_request", { detail: "groups" });
  if (error === "invalid slug") return fail("invalid_request", { detail: "title" });
  if (error === "slug already taken") return fail("conflict");
  if (error === "an authored skill cannot carry scripts") return fail("invalid_request", { detail: "body" });
  if (error === "the title does not match the skill's slug") return fail("invalid_request", { detail: "title" });
  return fail("internal");
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}
