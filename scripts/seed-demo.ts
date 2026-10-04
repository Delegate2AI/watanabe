/**
 * Local demo seeder (dev only). Populates the portal DB AND a self-contained
 * demo KB vault with coherent content, so every flag-on subsystem renders real
 * state instead of an empty shell.
 *
 * Run: `node_modules/.bin/tsx scripts/seed-demo.ts` from the repo root.
 *
 * Re-runnable: it clears the tables it owns first (see `seed/reset.ts`), which
 * also removes hand-made rows in those tables. Not wired into any route.
 *
 * What it writes:
 *   - `.data/demo-vault/docs/**`   19 KB notes + 6 meeting notes, spread across
 *                                  every clearance group (see seed/vault.ts).
 *   - `<MEMORY_CHECKOUT_DIR>/access/{groups,roles}.yaml`  6 people, 6 groups.
 *   - the portal DB               projects, board tasks, artifacts, shared docs,
 *                                 comment threads, suggestions, external links,
 *                                 chat documents, packages, meeting ingest rows.
 *
 * To read the demo vault instead of the real one, set `LOCAL_REPO_PATH` to the
 * printed path and restart `pnpm dev`.
 */
import { openDb } from "@/lib/db/client";
import { seedAccess } from "./seed/access";
import { seedAnnotations } from "./seed/db-annotations";
import { seedDocs } from "./seed/db-docs";
import { seedOps } from "./seed/db-ops";
import { seedWork } from "./seed/db-work";
import { resetSeedData } from "./seed/reset";
import { GROUPS, PEOPLE } from "./seed/roster";
import { seedVault } from "./seed/vault";

// tsx does not read `.env.local`, but the seeder must land in the same places
// the dev server reads from (PORTAL_DB_PATH, MEMORY_CHECKOUT_DIR,
// PROJECT_DOCS_DIR). Without this, `projectDocsRoot()` falls back to the
// container path `/data/project-docs` and the write fails.
try {
  process.loadEnvFile(".env.local");
} catch {
  console.warn("No .env.local found; using built-in defaults under .data/");
}

const db = openDb(process.env.PORTAL_DB_PATH?.trim() || ".data/portal.db");

const cleared = resetSeedData(db);
console.log(cleared.length > 0 ? `Cleared: ${cleared.join(", ")}` : "Cleared: nothing to clear");

seedWork(db);
seedDocs(db);
seedAnnotations(db);
seedOps(db);

const access = seedAccess();
const vault = seedVault();

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
const TABLES = [
  "projects", "project_threads", "project_documents", "tasks", "threads",
  "artifacts", "artifact_versions", "shared_docs", "shared_doc_versions",
  "doc_shares", "doc_comments", "doc_comment_threads", "doc_comment_messages",
  "doc_suggestions", "doc_links", "chat_documents", "chat_document_versions",
  "chat_document_promotions", "packages", "meetings", "ingested_meetings",
];

console.log("\nDatabase");
for (const table of TABLES) console.log(`  ${table.padEnd(26)} ${count(table)}`);

console.log("\nAccess");
console.log(`  ${access.dir}/access/{groups,roles}.yaml`);
console.log(`  ${PEOPLE.length} people across ${Object.keys(GROUPS).length} groups` +
  (access.committed ? " (committed to portal-memory)" : " (loose files, NOT committed)"));

console.log("\nDemo vault");
console.log(`  ${vault.root}/docs  ${vault.noteCount} notes (${vault.meetingCount} meetings)`);
for (const [group, notes] of Object.entries(vault.byGroup).sort()) {
  console.log(`  ${group.padEnd(14)} ${notes} notes`);
}
console.log(`\n  To use it:  LOCAL_REPO_PATH=${vault.root}   (then restart pnpm dev)`);

db.close();
