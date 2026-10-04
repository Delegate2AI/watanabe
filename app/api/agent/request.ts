import { z } from "zod";
import { MAX_CHIPS, MessageContextSchema } from "@/lib/agent/context";
import { resolveMessageContext, type ResolvedContext } from "@/lib/agent/context-resolve";
import { EFFORT_LEVELS, isAllowedModel, type ModelChoiceInput } from "@/lib/agent/model-options";
import { freshModelChoiceFor } from "@/lib/agent/fresh-model-choice";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const Body = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1, "message is required").max(100_000),
  context: z.array(MessageContextSchema).max(MAX_CHIPS).optional(),
  docId: z.string().uuid().optional(),
  connectors: z.array(z.string()).max(8).optional(),
  model: z.string().refine(isAllowedModel, "model is not on the allowlist").optional(),
  effort: z.enum(EFFORT_LEVELS as unknown as [string, ...string[]]).optional(),
});

export type AgentRequestBody = z.infer<typeof Body>;

export function appliedModelChoice(parsed: AgentRequestBody, ownerEmail: string): ModelChoiceInput | null {
  if (!parsed.model && !parsed.effort) return null;
  try {
    return freshModelChoiceFor(getDb(), parsed.sessionId, { model: parsed.model, effort: parsed.effort });
  } catch (e) {
    log.warn("model choice resolution skipped", {
      route: "POST /api/agent",
      owner: ownerEmail,
      sessionId: parsed.sessionId,
      err: String(e),
    });
    return null;
  }
}

export type ChipResolution =
  | { ok: true; chips: ResolvedContext[] }
  | { ok: false; response: Response };

export function resolveChips(parsed: AgentRequestBody, ownerEmail: string): ChipResolution {
  const chips: ResolvedContext[] = [];
  if (!parsed.context || parsed.context.length === 0) return { ok: true, chips };

  for (const chip of parsed.context) {
    if (chip.type === "shared-doc-selection" && chip.docId !== parsed.docId) {
      log.warn("agent request rejected", {
        route: "POST /api/agent",
        status: 400,
        reason: "context doc mismatch",
        owner: ownerEmail,
      });
      return { ok: false, response: fail("invalid_request", { detail: "context" }) };
    }
    const result = resolveMessageContext(chip);
    if (!result.ok) {
      log.warn("agent request rejected", {
        route: "POST /api/agent",
        status: 400,
        reason: "context containment",
        owner: ownerEmail,
        path: result.error.path,
      });
      return { ok: false, response: fail("invalid_request", { detail: "context" }) };
    }
    chips.push(result.resolved);
  }
  return { ok: true, chips };
}
