import { isFlagEnabled } from "@/lib/config/flags";

export function isActivityEnabled(): boolean {
  return isFlagEnabled("ACTIVITY_ENABLED");
}
