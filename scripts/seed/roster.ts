/**
 * The demo cast: people, their clearance groups, and their write roles. Every
 * other seed module refers to these, so a single edit here keeps the DB rows,
 * the vault frontmatter, and `access/{groups,roles}.yaml` consistent.
 *
 * Six people, matching the roster size the team-task-board spec assumes
 * (docs/superpowers/specs/2026-07-14-team-task-board-design.md).
 */

export type Role = "viewer" | "editor" | "approver" | "admin";

export interface Person {
  email: string;
  name: string;
  /** Clearance groups (groups.yaml). `all-hands` is implicit and always added. */
  groups: string[];
  /** Write capability (roles.yaml). */
  role: Role;
}

/** The dev identity (DEV_IDENTITY_EMAIL in .env.local). Owns most content. */
export const ME = "taylor.reed@example.com";

export const PEOPLE: Person[] = [
  { email: ME, name: "Taylor Reed", groups: ["engineering", "exec", "admins"], role: "admin" },
  { email: "maria.chen@example.com", name: "Maria Chen", groups: ["research"], role: "editor" },
  { email: "devon.brooks@example.com", name: "Devon Brooks", groups: ["engineering"], role: "editor" },
  { email: "priya.nair@example.com", name: "Priya Nair", groups: ["research", "finance"], role: "approver" },
  { email: "sam.rivera@example.com", name: "Sam Rivera", groups: ["finance", "exec"], role: "viewer" },
  { email: "alex.kim@example.com", name: "Alex Kim", groups: ["engineering"], role: "editor" },
];

/**
 * Every clearance group, including `all-hands`.
 *
 * `all-hands` is listed explicitly with the full roster even though
 * `resolveClearance()` prepends it implicitly. Reason: `setNoteVisibility()`
 * validates each requested group with `Object.hasOwn(groups, g)`, so an
 * `all-hands` key that is missing from groups.yaml makes the KB access admin
 * reject "make this note all-hands" even though its own picker offers it.
 */
export const GROUPS: Record<string, string[]> = {
  "all-hands": PEOPLE.map((p) => p.email),
  engineering: PEOPLE.filter((p) => p.groups.includes("engineering")).map((p) => p.email),
  research: PEOPLE.filter((p) => p.groups.includes("research")).map((p) => p.email),
  finance: PEOPLE.filter((p) => p.groups.includes("finance")).map((p) => p.email),
  exec: PEOPLE.filter((p) => p.groups.includes("exec")).map((p) => p.email),
  admins: PEOPLE.filter((p) => p.groups.includes("admins")).map((p) => p.email),
};

export const ROLES: Record<Role, string[]> = {
  viewer: PEOPLE.filter((p) => p.role === "viewer").map((p) => p.email),
  editor: PEOPLE.filter((p) => p.role === "editor").map((p) => p.email),
  approver: PEOPLE.filter((p) => p.role === "approver").map((p) => p.email),
  admin: PEOPLE.filter((p) => p.role === "admin").map((p) => p.email),
};

/** Clearance shorthand for content everyone can see. */
export const ALL = ["all-hands"];

export function nameFor(email: string): string {
  return PEOPLE.find((p) => p.email === email)?.name ?? email;
}

/**
 * What `resolveClearance()` will hand this person at runtime: `all-hands` plus
 * their memberships. Needed because the project-attach helpers re-check
 * visibility AS THE ACTOR, so seeding an attachment for someone else's task
 * only works when it is performed with that person's clearance.
 */
export function clearanceOf(email: string): string[] {
  const person = PEOPLE.find((p) => p.email === email);
  return ["all-hands", ...(person?.groups ?? []).filter((group) => group !== "all-hands")];
}

/** A July 2026 timestamp: `iso(12)` -> 2026-07-12T09:00:00.000Z. */
export function iso(day: number, hour = 9): string {
  return `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

/** The date-only form the vault frontmatter uses. */
export function day(d: number): string {
  return `2026-07-${String(d).padStart(2, "0")}`;
}
