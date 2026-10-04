"use client";

import { useRouter } from "next/navigation";
import { Composer } from "@/components/kit/composer";
import type { ModelOption } from "@/lib/agent/model-options";

/**
 * "New chat in this project" (spec 26): a Composer bound to a project. Submitting
 * mints a fresh thread and routes to it with the project id in the query, so the
 * chat runtime files the new thread into the project (and loads its context).
 * The Composer shows an "In {projectName}" affordance so the contributor knows
 * the chat will be filed here.
 */
export function ProjectChat({
  projectId,
  projectName,
  dictationEnabled = false,
  models = [],
  modelSwitchingEnabled = false,
}: {
  projectId: string;
  projectName: string;
  dictationEnabled?: boolean;
  models?: ModelOption[];
  modelSwitchingEnabled?: boolean;
}) {
  const router = useRouter();

  function startThread(value: string) {
    const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    router.push(`/chat/${id}?q=${encodeURIComponent(value)}&project=${encodeURIComponent(projectId)}`);
  }

  return (
    <Composer
      onSubmit={startThread}
      placeholder={`Start a chat in ${projectName}`}
      projectId={projectId}
      projectName={projectName}
      projectsEnabled
      dictationEnabled={dictationEnabled}
      models={models}
      modelSwitchingEnabled={modelSwitchingEnabled}
    />
  );
}
