import { isFlagEnabled } from "@/lib/config/flags";

/** Gates the KB graph tab and its API route. Independent of INDEX_ENABLED. */
export function isKbGraphEnabled(): boolean {
  return isFlagEnabled("KB_GRAPH_ENABLED");
}
