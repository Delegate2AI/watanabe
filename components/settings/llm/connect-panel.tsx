"use client";

import { Plug } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { harnessSnippets } from "@/lib/llm/harness-snippets";
import { CopyBlock } from "./copy-block";

const card = "rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";

/** Setup for each harness, pointing at the gate. */
export function ConnectPanel({ publicUrl, model }: { publicUrl: string | null; model: string }) {
  if (!publicUrl) {
    return (
      <div className={card}>
        <p className="text-sm text-ink-muted">The LLM endpoint is not configured on this server yet.</p>
      </div>
    );
  }
  const snippets = harnessSnippets(publicUrl, model);
  return (
    <div className={card}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Plug className="size-4 text-accent" />
        Connect your harness
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Replace the key placeholder with one of your keys. Model names are the ones 9router lists; your budgets tab shows which groups you can use.
      </p>
      <Tabs defaultValue={snippets[0].id} className="mt-4">
        <TabsList>
          {snippets.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {snippets.map((s) => (
          <TabsContent key={s.id} value={s.id} className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-ink-muted">{s.where}</p>
            <CopyBlock value={s.code} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
