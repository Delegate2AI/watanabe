import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Thread } from "@/components/chat/thread";
import { isAttachmentsEnabled } from "@/lib/attachments/store";
import { isDictationEnabled } from "@/lib/dictate/config";
import { isArtifactsEnabled } from "@/lib/artifacts/config";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { isModelSwitchingEnabled } from "@/lib/agent/model-options";
import { availableModelAllowlist } from "@/lib/agent/model-availability";
import { initialChoiceFrom } from "@/lib/chat/model-choice";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { getIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { getThreadModelChoice } from "@/lib/db/threads";

/**
 * A live chat thread (spec 24).
 *
 * A `?q=` seed means Home just minted this thread: the route id is a CLIENT
 * handle, so the page renders in "new" mode without an ownership check (the
 * first send starts fresh and adopts a real SDK id). WITHOUT a seed this is a
 * RESUME, so the page enforces ownership SERVER-SIDE: a foreign id AND an
 * unknown id both `notFound()` (identical 404, no existence oracle), instead of
 * silently rendering an empty thread. The optional composer capabilities and the
 * model allowlist are resolved server-side from their flags and passed down.
 * In Next 16 params/searchParams are async.
 */
function storedChoice(id: string): { model?: string | null; effort?: string | null } {
  try {
    return getThreadModelChoice(getDb(), id) ?? {};
  } catch {
    return {};
  }
}

export default async function ChatThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; connector?: string; model?: string; effort?: string; minted?: string }>;
}) {
  const { id } = await params;
  const { q, connector, model, effort, minted } = await searchParams;
  const isNew = Boolean(q);
  const preMinted = isNew && minted === "1";

  // Resume path: require the caller to own this thread. Foreign and unknown ids
  // are indistinguishable (both 404), matching the API routes' contract.
  if (!isNew || preMinted) {
    const identity = await getIdentity(await headers());
    if (!identity || !isOwnedBy(getDb(), id, identity.email)) notFound();
  }

  const models = await availableModelAllowlist();
  const initialChoice = isNew
    ? initialChoiceFrom(models, { model, effort })
    : initialChoiceFrom(models, storedChoice(id));

  return (
    <Thread
      id={id}
      initialQuery={q}
      preMinted={preMinted}
      initialConnector={isNew && isConnectorsEnabled() ? connector : undefined}
      attachmentsEnabled={isAttachmentsEnabled()}
      dictationEnabled={isDictationEnabled()}
      artifactsEnabled={isArtifactsEnabled()}
      canvasEnabled={isCanvasEnabled()}
      models={models}
      initialChoice={initialChoice}
      modelSwitchingEnabled={isModelSwitchingEnabled()}
      connectorsEnabled={isConnectorsEnabled()}
    />
  );
}
