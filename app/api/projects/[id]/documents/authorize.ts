import { requireIdentity } from "@/lib/auth/identity";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { getProjectForRequester } from "@/lib/db/projects";
import { fail } from "@/lib/errors/codes";
import { isProjectsEnabled } from "@/lib/projects/config";

/**
 * The one authorization seam every project-document route shares (spec 26
 * extension, surface-polish P-04).
 *
 * A project document is authorized by its PROJECT: a caller who may see the
 * project may see and manage its documents. Everything that is not "you may see
 * this project" collapses into the same 404, so a foreign project, an unknown
 * project, and a flag-off deployment are indistinguishable to a caller. That is
 * what keeps the download route from becoming an existence oracle.
 */

/** Foreign, unknown, and flag-off all answer with this identical 404. */
export const NOT_FOUND = (): Response => fail("not_found");

export type ProjectAuthz = { response: Response } | { email: string; clearance: string[] };

export async function authorizeProject(request: Request, id: string): Promise<ProjectAuthz> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return { response: auth.response } as const;
  if (!isProjectsEnabled()) return { response: NOT_FOUND() } as const;
  const email = auth.identity.email;
  // Returned, not merely used here: a KB reference resolves against the
  // requester's own clearance projection, so the references route needs the
  // clearance this seam already computed rather than resolving it a second time.
  const clearance = resolveClearance(email, loadGroups());
  const project = getProjectForRequester(getDb(), id, email, clearance);
  if (!project) return { response: NOT_FOUND() } as const;
  return { email, clearance } as const;
}
