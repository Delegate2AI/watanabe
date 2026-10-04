import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Wand2 } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { SkillAuthoring } from "@/components/skills/authoring";
import { can } from "@/lib/authority/roles";
import { resolveIdentity } from "@/lib/identity/resolve";
import { authorGroups } from "@/lib/skills/authors";
import { isSkillsEnabled } from "@/lib/skills/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SkillStudioPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!isSkillsEnabled()) notFound();
  if (authorGroups(identity.email).length === 0 && !can(identity.email, "manageAccess")) notFound();

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Wand2}
        eyebrow="Skill studio"
        title="Skill studio"
        description="Write a skill once and every chat in the groups you publish to can reach for it. You edit and remove only the skills you wrote."
      />
      <SkillAuthoring />
    </div>
  );
}
