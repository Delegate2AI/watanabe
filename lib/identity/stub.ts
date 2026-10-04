/**
 * Display-only identity stub, retained for tests and any surface that wants a
 * deterministic identity without a request in scope.
 *
 * The live shell no longer uses this: `app/(app)/layout.tsx` now resolves the
 * real request identity via `lib/identity/resolve.ts`. This stub stays because
 * component tests (home, thread, clearance-badge, admin) render surfaces in
 * isolation and need a fixed identity to assert against.
 *
 * The values mirror `design/ui-mock.html` ("Nick", cleared for All-hands + Exec).
 */

import type { Role } from "@/lib/authority/roles";

/**
 * The identity shape every shell surface renders from. `name` is always a
 * string at this boundary: the layout falls back to the email local-part when
 * the resolver has no display name, so consumers never handle `undefined`.
 * `role` is present only when ROLES_ENABLED is on (the admin surface reads it).
 */
export interface ShellIdentity {
  email: string;
  name: string;
  /**
   * The avatar's letters, resolved server-side by the layout. Present so no
   * client island has to derive them: `name.charAt(0)` gave "M" for Maria Chen
   * where the directory's rule gives "MC", and the directory is the one place
   * that rule may live.
   */
  initials: string;
  /** Clearance labels the requester can see, e.g. ["All-hands", "Exec"]. */
  clearance: string[];
  role?: Role;
}

/** Resolve the stubbed shell identity. Pure and synchronous by design. */
export function resolveStubIdentity(): ShellIdentity {
  return {
    email: "nick@example.com",
    name: "Nick",
    initials: "N",
    clearance: ["All-hands", "Exec"],
  };
}
