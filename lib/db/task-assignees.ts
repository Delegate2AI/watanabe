import { parseStringArray } from "./tasks-rows";

export interface AssigneeWrite {
  assignees: string;
  assigneeEmail: string | null;
}

export function normalizeAssignees(emails: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const email of emails) {
    const value = email?.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function assigneeWrite(emails: readonly (string | null | undefined)[]): AssigneeWrite {
  const normalized = normalizeAssignees(emails);
  return {
    assignees: JSON.stringify(normalized),
    assigneeEmail: normalized[0] ?? null,
  };
}

export function assigneesFromRow(raw: string | null, assigneeEmail: string | null): string[] {
  const parsed = parseStringArray(raw);
  if (parsed.length > 0) return parsed;
  return assigneeEmail ? [assigneeEmail] : [];
}
