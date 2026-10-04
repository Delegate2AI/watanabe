import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { accessFor } from "@/lib/documents/access";
import { isUnifiedDocsEnabled } from "@/lib/documents/config";
import { createDocument, dispositionFor } from "@/lib/documents/store";
import type { DocumentAccess, DocumentRecord } from "@/lib/documents/types";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateBody = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).refine((value) => value.trim() !== "", "body is empty"),
});

interface ListedRow {
  id: string;
  owner_email: string;
  title: string;
  current_version: number;
  origin_thread_id: string | null;
  created_at: string;
  updated_at: string;
  shared_access: DocumentAccess | null;
}

function listedDocument(row: ListedRow): DocumentRecord {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    currentVersion: row.current_version,
    originThreadId: row.origin_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isUnifiedDocsEnabled()) {
    return fail("not_found");
  }

  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await request.json());
  } catch (error) {
    log.info("documents request rejected", { route: "POST /api/documents", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const id = randomUUID();
    createDocument(getDb(), {
      id,
      ownerEmail: auth.identity.email,
      title: parsed.title,
      body: parsed.body,
      originThreadId: null,
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    log.error("documents request failed", { route: "POST /api/documents", status: 500, err: String(error) });
    return fail("internal");
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isUnifiedDocsEnabled()) {
    return fail("not_found");
  }

  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT d.*, s.access AS shared_access
       FROM documents d
       LEFT JOIN document_shares s
         ON s.doc_id = d.id AND s.recipient_email = @email
       WHERE d.owner_email = @email OR s.recipient_email = @email
       ORDER BY d.updated_at DESC`,
    ).all({ email: auth.identity.email }) as ListedRow[];
    const documents = rows.map((row) => ({
      ...listedDocument(row),
      access: accessFor(db, row.id, auth.identity.email),
      disposition: dispositionFor(db, row.id),
    }));
    return Response.json({ documents });
  } catch (error) {
    log.error("documents request failed", { route: "GET /api/documents", status: 500, err: String(error) });
    return fail("internal");
  }
}
