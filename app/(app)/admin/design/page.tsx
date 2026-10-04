import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Palette } from "lucide-react";
import { DesignGuideAdmin } from "@/components/admin/design-guide-admin";
import { PageHeader } from "@/components/kit/page-header";
import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { DESIGN_CONSTRAINTS } from "@/lib/agent/design-prompt";
import { can } from "@/lib/authority/roles";
import { MAX_DESIGN_GUIDE_BYTES } from "@/lib/design-guide/config";
import { loadDesignGuide } from "@/lib/design-guide/store";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { resolveIdentity } from "@/lib/identity/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The house style for designed documents.
 *
 * Gated exactly like `/admin/connectors`: `notFound()` for anyone without
 * `manageAccess`, plus the subsystem flag, so with `HTML_DOCUMENTS_ENABLED` off
 * the page does not exist and the sidebar shows no link to it.
 *
 * The guide is read HERE, on the server: the loader reaches `node:fs` and the
 * surface below is a client island, so it receives plain strings.
 */
export default async function DesignGuidePage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!isHtmlDocumentsEnabled()) notFound();
  if (!can(identity.email, "manageAccess")) notFound();

  const guide = loadDesignGuide();

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Palette}
        eyebrow="Administration"
        title="Document design"
        description="The art direction the assistant follows when it writes a document as a designed page. Every change is recorded on the private access history, and Try it renders a sample before you save."
      />
      <DesignGuideAdmin
        guide={guide}
        builtIn={DEFAULT_DESIGN_HOUSE_STYLE}
        constraints={DESIGN_CONSTRAINTS}
        maxBytes={MAX_DESIGN_GUIDE_BYTES}
      />
    </div>
  );
}
