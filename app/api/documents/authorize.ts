import type { Database as DatabaseType } from "better-sqlite3";
import { requireIdentity } from "@/lib/auth/identity";
import type { Identity } from "@/lib/auth/types";
import { accessFor, type EffectiveAccess } from "@/lib/documents/access";
import { isUnifiedDocsEnabled } from "@/lib/documents/config";

export function notFound(): Response {
  return Response.json({ error: "document not found" }, { status: 404 });
}

export async function requireEnabledIdentity(
  request: Request,
): Promise<{ identity: Identity } | { response: Response }> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth;
  if (!isUnifiedDocsEnabled()) return { response: notFound() };
  return { identity: auth.identity };
}

export async function authorizeDocument(
  request: Request,
  db: DatabaseType,
  docId: string,
): Promise<{ identity: Identity; access: EffectiveAccess } | { response: Response }> {
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate;
  return {
    identity: gate.identity,
    access: accessFor(db, docId, gate.identity.email),
  };
}
