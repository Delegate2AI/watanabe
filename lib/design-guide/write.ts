import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { can } from "@/lib/authority/roles";
import { commitPrivateAccess } from "@/lib/repo-write-private-access";
import { DESIGN_GUIDE_ACCESS_PATH } from "./config";
import { invalidateDesignGuideCache } from "./store";
import { checkDesignGuide, type GuideProblem } from "./validate";

/**
 * The admin write path for `access/design-guide.md`, the same git-audited ref
 * `connectors.yaml` and `flags.yaml` live on. Same shape as
 * `lib/connectors/store.ts`: capability check, validate, one commit through
 * `commitPrivateAccess`, then invalidate the read cache.
 */

export type DesignGuideWriteResult =
  | { ok: true }
  | { ok: false; error: string; problems?: GuideProblem[] };

/**
 * Save a house style. `text` is the whole file: there is no merge, because a
 * guide is one piece of prose and a partial edit of prose has no meaning.
 */
export async function writeDesignGuide(text: string, actorEmail: string): Promise<DesignGuideWriteResult> {
  const author = actorEmail.trim().toLowerCase();
  if (!can(author, "manageAccess")) return { ok: false, error: "forbidden" };

  const checked = checkDesignGuide(text);
  if (!checked.ok) return { ok: false, error: "invalid design guide", problems: checked.problems };

  // Normalised on the way in so a paste from a rich editor does not show up as
  // a whole-file diff on the ref, and so the stored bytes match what the
  // surface will read back.
  const normalised = `${text.replace(/\r\n/g, "\n").trim()}\n`;
  // Saving the built-in guide clears the override rather than storing a copy of
  // it. A stored copy is frozen: the surface would keep reporting an edited
  // guide, and every later improvement to the shipped default would stop short
  // of this deployment with nobody able to see why. The loader reads an empty
  // file as "no override", so an emptied file IS the restore, and the commit
  // records that it happened.
  const restoring = normalised.trim() === DEFAULT_DESIGN_HOUSE_STYLE.trim();
  const committed = await commitPrivateAccess(
    { [DESIGN_GUIDE_ACCESS_PATH]: restoring ? "" : normalised },
    {
      authorName: author,
      authorEmail: author,
      message: restoring
        ? "chore(access): restore the built-in document design guide"
        : "chore(access): update the document design guide",
    },
  );
  if (!committed.ok) return { ok: false, error: committed.error };
  invalidateDesignGuideCache();
  return { ok: true };
}
