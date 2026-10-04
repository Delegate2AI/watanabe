import { headers } from "next/headers";
import { Boxes } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { ArtifactGrid } from "@/components/artifacts/artifact-grid";
import { getDb } from "@/lib/db/client";
import { listArtifactsForOwner } from "@/lib/db/artifacts";
import { resolveIdentity } from "@/lib/identity/resolve";
import { isArtifactsEnabled } from "@/lib/artifacts/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Artifacts surface (spec 27), filling the spec-18 scaffold. Flag-off it
 * renders the identical empty scaffold as before, so the byte-path is unchanged.
 * On: the owner's own artifacts (owner-scoped read) as a card grid.
 */
export default async function ArtifactsPage() {
  if (!isArtifactsEnabled()) {
    return (
      <RouteScaffold
        icon={Boxes}
        eyebrow="Artifacts"
        title="Things you made with Watanabe"
        description="Documents and drafts the assistant produced. Publish one back to the knowledge base to share it with everyone cleared for it."
        spec="spec 27"
        flag="ARTIFACTS_ENABLED"
      />
    );
  }

  const identity = await resolveIdentity(await headers());
  const artifacts = identity ? listArtifactsForOwner(getDb(), identity.email) : [];

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Boxes}
        eyebrow="Artifacts"
        title="Things you made with Watanabe"
        description="Documents and drafts the assistant produced. Publish one back to the knowledge base to share it with everyone cleared for it."
      />
      <ArtifactGrid
        artifacts={artifacts.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status,
          sourceThreadId: a.sourceThreadId,
          updatedAt: a.updatedAt,
        }))}
      />
    </div>
  );
}
