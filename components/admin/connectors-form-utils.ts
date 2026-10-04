import type { ConnectorRow, FormValues } from "./connectors-form-types";

export function pairsToText(pairs: Record<string, string> | undefined): string {
  return Object.entries(pairs ?? {}).map(([key, value]) => `${key}: ${value}`).join("\n");
}

export function textToPairs(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const at = trimmed.indexOf(":");
    if (at < 1) continue;
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function splitList(text: string, separator: string): string[] | undefined {
  const items = text.split(separator).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function maybe<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export function staleGroups(row: ConnectorRow | null, groupNames: string[]): string[] {
  return (row?.groups ?? []).filter((group) => !groupNames.includes(group));
}

export function initialValues(row: ConnectorRow | null, groupNames: string[]): FormValues {
  return {
    slug: row?.slug ?? "",
    title: row?.title ?? "",
    transport: row?.transport ?? "http",
    url: row?.url ?? "",
    headers: pairsToText(row?.headers),
    command: row?.command ?? "",
    args: (row?.args ?? []).join("\n"),
    env: pairsToText(row?.env),
    groups: (row?.groups ?? []).filter((group) => groupNames.includes(group)),
    tools: (row?.tools ?? []).join(", "),
    description: row?.description ?? "",
    icon: row?.icon ?? "",
    auth: row?.auth ?? "none",
    oauthClientId: row?.oauthClientId ?? "",
    oauthClientSecret: "",
    authOrigins: (row?.authOrigins ?? []).join("\n"),
  };
}
