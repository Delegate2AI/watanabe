import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { loadConnectorRegistry } from "./registry";
import type { ConnectorEntry } from "./types";

export function findClearedConnectorEntry(slug: string, email: string): ConnectorEntry | undefined {
  const clearance = new Set(resolveClearanceForEmail(email));
  return loadConnectorRegistry().entries.find(
    (entry) => entry.slug === slug && entry.groups.some((group) => clearance.has(group)),
  );
}
