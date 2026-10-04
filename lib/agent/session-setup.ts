import { vaultRootFor } from "@/lib/repo";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { getDb } from "@/lib/db/client";
import { getThreadModelChoice } from "@/lib/db/threads";
import { projectContextForThread } from "@/lib/db/project-context";
import { isProjectsEnabled } from "@/lib/projects/config";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { EMPTY_GRANTS, resolveConnectorGrants, type ConnectorGrants } from "@/lib/connectors/grants";
import type { OauthBearer } from "@/lib/connectors/types";
import { attachmentDirFor, isAttachmentsEnabled } from "@/lib/attachments/store";
import { isSkillsEnabled } from "@/lib/skills/config";
import { materializeSkillsPlugin } from "@/lib/skills/materialize";
import { lastSessionCostUsd } from "./session-registry";
import type { ModelChoiceInput } from "./model-options";

/**
 * Constructor-time resolution for an `AgentSession`, split out of the class
 * (file-size split; behavior unchanged): clearance, the authority scope root,
 * connector grants, the skills plugin, the per-thread model choice, and the
 * cost carried across a resume.
 */
export interface SessionSetup {
  clearanceSet: string[];
  authorityScopeRoot?: string;
  /** Spec 33 grants; EMPTY_GRANTS unless the flag is on. */
  connectorGrants: ConnectorGrants;
  skillsPlugin: { pluginPath: string; slugs: readonly string[] } | null;
  skillSlugs: ReadonlySet<string>;
  modelChoice: { model: string | null; effort: string | null } | null;
  carriedCostUsd: number;
  attachmentDir?: string;
  projectContext?: string;
}

export function attachmentRootFor(ownerEmail: string, threadId: string): string | undefined {
  if (!isAttachmentsEnabled()) return undefined;
  return attachmentDirFor(ownerEmail, threadId);
}

function attachmentDirForSession(ownerEmail: string, threadId: string | undefined): string | undefined {
  return threadId ? attachmentRootFor(ownerEmail, threadId) : undefined;
}

function storedModelOverride(threadId: string): { model: string | null; effort: string | null } | null {
  let stored: { model: string | null; effort: string | null } | null = null;
  try {
    stored = getThreadModelChoice(getDb(), threadId);
  } catch {
    return null;
  }
  return stored && (stored.model || stored.effort) ? stored : null;
}

function resolveProjectContext(ownerEmail: string, threadId: string | undefined, clearanceSet: string[]): string | undefined {
  if (!threadId || !isProjectsEnabled()) return undefined;
  try {
    return projectContextForThread(getDb(), threadId, ownerEmail, clearanceSet);
  } catch {
    return undefined;
  }
}

function resolveModelOverride(
  resume: string | undefined,
  adoptSessionId: string | undefined,
  requestedChoice: ModelChoiceInput | null | undefined,
): { model: string | null; effort: string | null } | null {
  const threadId = resume ?? adoptSessionId;
  const stored = threadId ? storedModelOverride(threadId) : null;
  if (resume) return stored;
  const model = stored?.model ?? requestedChoice?.model ?? null;
  const effort = stored?.effort ?? requestedChoice?.effort ?? null;
  return model || effort ? { model, effort } : null;
}

export function resolveSessionSetup(
  ownerEmail: string,
  resume: string | undefined,
  localFallbackId: string,
  pendingConnectorSlugs?: readonly string[],
  oauthBearer?: ReadonlyMap<string, OauthBearer>,
  requestedChoice?: ModelChoiceInput | null,
  adoptSessionId?: string,
): SessionSetup {
  const clearanceSet = resolveClearanceForEmail(ownerEmail);
  const authorityScopeRoot = isAuthorityEnabled() ? vaultRootFor(clearanceSet) : undefined;
  const connectorGrants = isConnectorsEnabled()
    ? resolveConnectorGrants(getDb(), resume ?? localFallbackId, clearanceSet, undefined, pendingConnectorSlugs, oauthBearer)
    : EMPTY_GRANTS;
  // Spec 34: the plugin directory holding exactly the skills this caller's
  // clearance may see. Never throws (see lib/skills/materialize.ts): a null
  // here is simply a session with no skills. `slugs` additionally gates the
  // Skill tool, so materialization is not the only boundary.
  const skillsPlugin = isSkillsEnabled() ? materializeSkillsPlugin(clearanceSet) : null;
  const modelChoice = resolveModelOverride(resume, adoptSessionId, requestedChoice);
  return {
    clearanceSet,
    authorityScopeRoot,
    connectorGrants,
    skillsPlugin,
    skillSlugs: new Set(skillsPlugin?.slugs ?? []),
    modelChoice,
    carriedCostUsd: resume ? (lastSessionCostUsd.get(resume) ?? 0) : 0,
    attachmentDir: attachmentDirForSession(ownerEmail, resume ?? adoptSessionId),
    projectContext: resolveProjectContext(ownerEmail, resume ?? adoptSessionId, clearanceSet),
  };
}
