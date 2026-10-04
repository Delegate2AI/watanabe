"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LlmKey } from "@/lib/db/llm-keys";
import type { BudgetRequest } from "@/lib/db/llm-requests";
import { exampleModel } from "@/lib/llm/harness-snippets";
import type { UserBudgetView } from "@/lib/llm/view-types";
import { BudgetsPanel } from "./budgets-panel";
import { ConnectPanel } from "./connect-panel";
import { KeysPanel } from "./keys-panel";

export function LlmSettings({
  keys,
  budgets,
  requests,
  publicUrl,
}: {
  keys: LlmKey[];
  budgets: UserBudgetView[];
  requests: BudgetRequest[];
  publicUrl: string | null;
}) {
  return (
    <Tabs defaultValue="keys">
      <TabsList>
        <TabsTrigger value="keys">Keys</TabsTrigger>
        <TabsTrigger value="budgets">Budgets</TabsTrigger>
        <TabsTrigger value="connect">Connect</TabsTrigger>
      </TabsList>
      <TabsContent value="keys" className="mt-4">
        <KeysPanel keys={keys} />
      </TabsContent>
      <TabsContent value="budgets" className="mt-4">
        <BudgetsPanel budgets={budgets} requests={requests} />
      </TabsContent>
      <TabsContent value="connect" className="mt-4">
        <ConnectPanel publicUrl={publicUrl} model={exampleModel(budgets.flatMap((b) => b.models))} />
      </TabsContent>
    </Tabs>
  );
}
