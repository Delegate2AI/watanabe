import { Home } from "@/components/home/home";
import { isDictationEnabled } from "@/lib/dictate/config";
import { isModelSwitchingEnabled } from "@/lib/agent/model-options";
import { availableModelAllowlist } from "@/lib/agent/model-availability";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { isAttachmentsEnabled } from "@/lib/attachments/store";
import { isContentConfigured } from "@/lib/content/config";

/** The shell Home surface (spec 18): greeting + Composer + starter chips. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ connector?: string }>;
}) {
  const { connector } = await searchParams;
  return (
    <Home
      dictationEnabled={isDictationEnabled()}
      models={await availableModelAllowlist()}
      modelSwitchingEnabled={isModelSwitchingEnabled()}
      connectorsEnabled={isConnectorsEnabled()}
      attachmentsEnabled={isAttachmentsEnabled()}
      // Flag AND credential, resolved on the server like every other flag here.
      // is worse than no chip.
      shortFormContentEnabled={isContentConfigured()}
      initialConnector={isConnectorsEnabled() ? connector : undefined}
    />
  );
}
