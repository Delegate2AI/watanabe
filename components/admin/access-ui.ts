import type { Role } from "@/lib/authority/roles";

/**
 * Shared presentation constants for the access administration tabs.
 *
 * ROLE_NAMES is defined here rather than imported from lib/authority/roles:
 * that module pulls node:fs (the roles.yaml loader), which a "use client"
 * component cannot bundle (Turbopack fails code generation). Keep it in sync
 * with ROLE_NAMES there.
 */
export const ROLE_NAMES: readonly Role[] = ["viewer", "editor", "approver", "admin"];

export const buttonClass = "min-h-10 rounded-lg px-3 text-sm font-medium transition-[scale,background-color] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45";

export const inputClass = "min-h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent";
