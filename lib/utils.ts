import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicting utility classes (last wins). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a USD cost for the turn/session cost displays in the agent chat UI. */
export function formatUsd(v?: number | null): string {
  if (v == null) return "—";
  if (v === 0) return "$0";
  if (v < 0.01) return `<$0.01`;
  return `$${v.toFixed(2)}`;
}
