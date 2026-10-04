"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, PenLine, BarChart3, GraduationCap, Search, ListChecks, Megaphone, Plug, X } from "lucide-react";
import { useIdentity } from "@/components/identity-provider";
import { Composer } from "@/components/kit/composer";
import { StarterChip } from "@/components/kit/starter-chip";
import { labelForEffort, labelForModel, type ModelOption } from "@/lib/agent/model-options";
import { readStoredChoice, writeStoredChoice, type ChatModelChoice } from "@/lib/chat/model-choice";

/**
 * The Home surface (spec 18): a centered serif greeting from the identity, the
 * Composer, and starter chips. Submitting the composer opens a fresh thread
 * (`/chat/<id>`); the real runtime is spec 24, so the id is a client-minted
 * placeholder. Generative chips seed the composer additively (see `prefill`, it
 * never discards typed text); navigational chips route to their surface.
 */
export function Home({
  dictationEnabled = false,
  models = [],
  modelSwitchingEnabled = false,
  connectorsEnabled = false,
  attachmentsEnabled = false,
  shortFormContentEnabled = false,
  initialConnector,
}: {
  dictationEnabled?: boolean;
  models?: ModelOption[];
  modelSwitchingEnabled?: boolean;
  connectorsEnabled?: boolean;
  attachmentsEnabled?: boolean;
  shortFormContentEnabled?: boolean;
  initialConnector?: string;
}) {
  const { name } = useIdentity();
  const router = useRouter();
  const [connector, setConnector] = useState<string | null>(initialConnector ?? null);
  // A starter chip seeds the composer through `prefill`, never by remounting it
  // with a fresh `initialValue`. The remount used to throw away everything the
  // user had already typed: sixty characters in, one click on "Write a doc", and
  // the field read "Help me write a doc about " and nothing else. The nonce is
  // what lets the same chip fire twice.
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>(undefined);
  const apply = (text: string) => setSeed((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  const [mintedId, setMintedId] = useState<string | null>(null);
  const [choice, setChoice] = useState<ChatModelChoice>({});
  useEffect(() => {
    queueMicrotask(() => setChoice(readStoredChoice(models)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startThread(value: string) {
    const id = mintedId ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    writeStoredChoice(choice);
    const suffix = connector ? `&connector=${encodeURIComponent(connector)}` : "";
    const modelParam = choice.model ? `&model=${encodeURIComponent(choice.model)}` : "";
    const effortParam = choice.effort ? `&effort=${choice.effort}` : "";
    const mintedParam = mintedId ? "&minted=1" : "";
    router.push(`/chat/${id}?q=${encodeURIComponent(value)}${suffix}${modelParam}${effortParam}${mintedParam}`);
  }

  function removeConnector() {
    setConnector(null);
    window.history.replaceState(null, "", "/");
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 pb-20 pt-10">
      <div className="mb-7 flex items-center gap-3.5">
        <Sparkles className="size-7 text-accent" aria-hidden />
        <h1 className="text-[34px] font-medium tracking-tight text-ink [font-family:var(--serif)] text-balance">
          Back at it, {name}
        </h1>
      </div>

      {connector && (
        <div className="mb-3 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-muted">
          <Plug className="size-3.5" aria-hidden />
          <span>Starts with the {connector} connector</span>
          <button
            type="button"
            aria-label={`Remove the ${connector} connector`}
            onClick={removeConnector}
            className="text-ink-faint transition-colors hover:text-ink"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <Composer
        prefill={seed}
        autoFocus
        onSubmit={startThread}
        dictationEnabled={dictationEnabled}
        models={models}
        modelSwitchingEnabled={modelSwitchingEnabled}
        model={labelForModel(models, choice.model)}
        level={labelForEffort(choice.effort)}
        onModelChange={(next) => setChoice((prev) => ({ ...prev, ...next }))}
        connectorsEnabled={connectorsEnabled}
        attachmentsEnabled={attachmentsEnabled}
        threadId={mintedId ?? undefined}
        onThreadMinted={setMintedId}
        className="max-w-3xl"
      />

      <div className="mt-5 flex max-w-3xl flex-wrap justify-center gap-2.5">
        <StarterChip
          label="Write a doc"
          icon={PenLine}
          onClick={() => apply("Help me write a doc about ")}
        />
        <StarterChip
          label="Strategize"
          icon={BarChart3}
          onClick={() => apply("Help me think through a strategy for ")}
        />
        <StarterChip label="Learn" icon={GraduationCap} onClick={() => apply("Explain ")} />
        {shortFormContentEnabled && (
          <StarterChip
            label="Write a social post"
            icon={Megaphone}
            onClick={() => apply("Draft three LinkedIn post variants about ")}
          />
        )}
        <StarterChip label="Find in the KB" icon={Search} href="/kb" />
        <StarterChip label="My tasks" icon={ListChecks} href="/tasks" />
      </div>
    </div>
  );
}
