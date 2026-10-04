"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LlmKey } from "@/lib/db/llm-keys";
import type { DailyUsageSummary } from "@/lib/db/llm-usage";
import type { BudgetRow, ModelGroup } from "@/lib/llm/types";
import type { AdminRequestView } from "@/lib/llm/view-types";
import { BudgetsPanel } from "./budgets-panel";
import { GroupsPanel } from "./groups-panel";
import { RequestsPanel } from "./requests-panel";
import { UsagePanel } from "./usage-panel";

export interface LlmAdminData {
  requests: AdminRequestView[];
  groups: ModelGroup[];
  budgets: BudgetRow[];
  teams: string[];
  keys: LlmKey[];
  usageThisMonth: DailyUsageSummary[];
  usageLastMonth: DailyUsageSummary[];
  seenModels: string[];
}

export function LlmAdmin({ data }: { data: LlmAdminData }) {
  const pending = data.requests.filter((r) => r.status === "pending").length;
  return (
    <Tabs defaultValue={pending > 0 ? "requests" : data.groups.length === 0 ? "groups" : "budgets"}>
      <TabsList>
        <TabsTrigger value="requests">Requests{pending > 0 ? ` (${pending})` : ""}</TabsTrigger>
        <TabsTrigger value="budgets">Budgets</TabsTrigger>
        <TabsTrigger value="groups">Model groups</TabsTrigger>
        <TabsTrigger value="usage">Usage and keys</TabsTrigger>
      </TabsList>
      <TabsContent value="requests" className="mt-4">
        <RequestsPanel requests={data.requests} />
      </TabsContent>
      <TabsContent value="budgets" className="mt-4">
        <BudgetsPanel teams={data.teams} groups={data.groups} budgets={data.budgets} />
      </TabsContent>
      <TabsContent value="groups" className="mt-4">
        <GroupsPanel groups={data.groups} seenModels={data.seenModels} />
      </TabsContent>
      <TabsContent value="usage" className="mt-4">
        <UsagePanel thisMonth={data.usageThisMonth} lastMonth={data.usageLastMonth} keys={data.keys} />
      </TabsContent>
    </Tabs>
  );
}
