import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Plug } from "lucide-react";
import { ConnectorDirectory } from "@/components/connectors/directory";
import { PageHeader } from "@/components/kit/page-header";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { resolveIdentity } from "@/lib/identity/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ConnectorsPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!isConnectorsEnabled()) notFound();

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Plug}
        eyebrow="Connectors"
        title="Connectors"
        description="External tools you are cleared to bring into a chat. Ask for one we do not have yet, and it will reach an admin."
      />
      <ConnectorDirectory />
    </div>
  );
}
