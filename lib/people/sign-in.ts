import { enqueue } from "@/lib/jobs/queue";
import { isPeopleEnabled } from "./config";
import { looksLikeOpaqueId } from "./display-name";
import { loadPeople, upsertPerson } from "./store";

/**
 * Self-population of the people directory from the SSO identity header.
 *
 * The IdP already sends a display name on every request, so most of the org
 * gets named without anyone typing anything. This runs behind
 * `resolveIdentity()`, which must NOT gain a failure mode: nothing here throws,
 * nothing here is awaited by the caller, and a refused write is logged and
 * dropped.
 */

const JOB_FAMILY = "people";

// Which (email, name) pair this process has already tried to persist. Two jobs
// for one person must not queue behind each other on every request, and the
// alternative (a directory read per request) would put a synchronous file read
// on the identity path. Set BEFORE the write, not after: a permanently failing
// write must cost one attempt per process, not one per request.
const g = globalThis as unknown as { __peopleNameAttempts?: Map<string, string> };

function attempts(): Map<string, string> {
  return (g.__peopleNameAttempts ??= new Map());
}

export function __resetPeopleSignInForTests(): void {
  delete g.__peopleNameAttempts;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Notes the display name the identity provider sent for this person, writing it
 * to the directory when it is new. Returns immediately: the write happens on
 * the serialized `people` job family.
 */
export function notePersonName(email: string, name?: string): void {
  const key = email.trim().toLowerCase();
  try {
    if (!isPeopleEnabled()) return;
    const display = (name ?? "").trim();
    if (!key || !display) return;
    // The header is not guaranteed to hold a name. Writing an opaque user id
    // here would make it that person's label everywhere, and it would outrank
    // the humanized address, which is the better fallback of the two.
    if (looksLikeOpaqueId(display, key)) return;
    if (attempts().get(key) === display) return;
    attempts().set(key, display);

    const existing = loadPeople()[key];
    // A manual edit wins over the header until the header value changes again,
    // so an admin's correction is not undone by the next sign-in.
    if (existing?.source === "manual") return;
    if (existing?.name === display) return;

    enqueue(JOB_FAMILY, key, async () => {
      try {
        // The flag is rechecked here, not just at enqueue time: a queued write
        // can run after the feature was turned off, and flag-off promises the
        // file is never written.
        if (!isPeopleEnabled()) return;
        await upsertPerson(key, { name: display, source: "idp" });
      } catch (error) {
        console.error(`[people] sign-in name write failed for ${key}: ${message(error)}`);
      }
    });
  } catch (error) {
    console.error(`[people] could not note the name for ${key}: ${message(error)}`);
  }
}
