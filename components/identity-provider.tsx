"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ShellIdentity } from "@/lib/identity/stub";

/**
 * The single source of truth for identity + clearance in the shell (spec 18).
 *
 * The server layout resolves the real request identity (`lib/identity/resolve.ts`)
 * and passes it here as a `ShellIdentity`. Every surface that shows who-you-are
 * or what-you-can-see (ClearanceBadge, VisibilityChip, the avatar, the greeting,
 * and the admin surface via `role`) reads from THIS context and nowhere else.
 */
const IdentityContext = createContext<ShellIdentity | null>(null);

export function IdentityProvider({
  identity,
  children,
}: {
  identity: ShellIdentity;
  children: ReactNode;
}) {
  return (
    <IdentityContext.Provider value={identity}>
      {children}
    </IdentityContext.Provider>
  );
}

/**
 * Read the current identity. Throws if used outside an `IdentityProvider` so a
 * misplaced consumer fails loudly in development rather than silently rendering
 * an empty clearance (which would be a security-adjacent footgun).
 */
export function useIdentity(): ShellIdentity {
  const value = useContext(IdentityContext);
  if (value === null) {
    throw new Error("useIdentity must be used within an IdentityProvider");
  }
  return value;
}

export type { ShellIdentity };
