import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";

/** One admin mutation: JSON in, a toast either way, true on success. */
export async function adminCall(method: string, url: string, body?: unknown, success?: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      notifyFailure(messageForBody(await response.json().catch(() => null)));
      return false;
    }
    if (success) notifySuccess(success);
    return true;
  } catch {
    notifyFailure("Could not reach the server. Try again.");
    return false;
  }
}

export const card = "rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";
export const input = "h-8 rounded-control border border-line bg-surface px-2 text-sm text-ink";
export const button = "h-8 rounded-control border border-line px-3 text-sm text-ink hover:bg-surface-hover disabled:opacity-60";
export const primary = "h-8 rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60";
export const danger = "h-8 rounded-control border border-line px-3 text-sm text-danger hover:bg-surface-hover disabled:opacity-60";
