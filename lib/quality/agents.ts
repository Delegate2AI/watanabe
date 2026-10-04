/**
 * Judgment agents for the write-path quality gates (spec 12, subsystem B3):
 * `citation-checker` and `style-reviewer` run as bounded headless SDK
 * queries over the whole staged diff at `kb_submit` time, mirroring
 * `lib/memory/dream.ts`'s `query()` idiom. Unlike a dream, these agents get
 * no tools: they judge the diff text handed to them in the prompt and report
 * back, so `allowedTools` stays empty and the "output" is the model's own
 * final text, parsed as JSON lines.
 *
 * Advisory only: this module NEVER throws. A disabled flag, an empty diff, a
 * query failure, or a garbled response all fall through to `[]`.
 */
import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolveAgentEnv } from "@/lib/agent/auth";
import { captureUsage, ownerForThread } from "@/lib/usage/capture";
import { createKbReadOnlyMcpServer } from "@/lib/kb-mcp/read-tools";
import { log } from "@/lib/log";
import { withTimeout } from "@/lib/memory/timeout";
import { isIntegrityEnabled, isQualityGatesEnabled } from "./config";

const MODEL = process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8";

const DEFAULT_QUALITY_AGENT_TIMEOUT_MS = 60_000;

function qualityAgentTimeoutMs(): number {
  const raw = process.env.QUALITY_AGENT_TIMEOUT_MS?.trim();
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUALITY_AGENT_TIMEOUT_MS;
}

/**
 * `deliverable-check` is not a judgment agent run by this module; it tags a
 * finding from `lib/quality/gather.ts`'s mechanical re-scan of the whole
 * staged diff (spec 12, subsystem B4), so the confirm modal can distinguish
 * it from `citation-checker`/`style-reviewer` output while sharing the same
 * `AdvisoryFinding` shape.
 */
export type AdvisoryAgentName = "citation-checker" | "style-reviewer" | "deliverable-check" | "integrity-checker";
export type AdvisorySeverity = "info" | "warn";

export interface AdvisoryFinding {
  agent: AdvisoryAgentName;
  severity: AdvisorySeverity;
  message: string;
}

const OUTPUT_CONTRACT = [
  "Output format (follow exactly):",
  'Output ONLY JSON lines, one finding per line, each shaped exactly as {"severity": "warn", "message": "..."} or {"severity": "info", "message": "..."}.',
  "No prose, no markdown fences, no numbering, nothing but JSON lines.",
  "If you find no issues, output nothing at all.",
].join("\n");

/** citation-checker: grounded in research-harness's agent of the same name (spec 12, B5). */
export function citationCheckerPrompt(): string {
  return [
    "You are a citation and sourcing auditor for a knowledge base diff.",
    "You will be given a unified diff of proposed edits to markdown notes. Read only the added",
    "lines (lines starting with a single +, not the +++ file header).",
    "",
    "Find every specific figure or claim presented as fact in the added lines: percentages,",
    "dollar amounts, rates, counts, or a claim attributed to an external source. For each one,",
    "check whether the same line or its immediate surrounding added text carries a citation: a",
    "markdown link, a URL, or a vault-relative path to another note (a path ending in a file",
    "extension such as .md).",
    "",
    "A figure or claim with no citation nearby is unsourced. Report it with severity warn when it",
    "reads as a hard, load-bearing fact stated with no hedge. Report it with severity info when it",
    "is a softer case worth a second look, such as a round or clearly illustrative number.",
    "",
    "Do not flag numbers that are not factual claims: section numbers, calendar dates used as",
    "dates, code, file paths, or plain item counts in a list.",
    "",
    OUTPUT_CONTRACT,
    "Each message should name the figure or claim and quote the line it appears on.",
  ].join("\n");
}

/** style-reviewer: grounded in research-harness's agent of the same name (spec 12, B3). */
export function styleReviewerPrompt(): string {
  return [
    "You are a style and structure reviewer for a knowledge base diff.",
    "You will be given a unified diff of proposed edits to markdown notes. Read only the added",
    "lines (lines starting with a single +, not the +++ file header).",
    "",
    "Flag structural and rhetorical problems in the added prose:",
    "- Unsupported superlatives (best, first, only, unprecedented) with nothing backing them up.",
    "- Vague attributions (studies show, experts agree, it is widely believed) naming no source.",
    "- Scaffolding and filler: meta-structure headers that restate the obvious, throat-clearing",
    "  introductions, and mid-sentence bolded labels standing in for real prose.",
    "- Promotional or advocacy tone: leading with benefits and burying trade-offs, marketing",
    "  language in a factual note.",
    "",
    "Report only real problems present in the added text; do not invent issues to fill a quota.",
    "",
    OUTPUT_CONTRACT,
    "Use severity warn for a clear structural or rhetorical problem and info for a soft",
    "suggestion. Each message should quote or closely paraphrase the offending text and name the",
    "problem.",
  ].join("\n");
}

/** integrity-checker: searches the vault for content related to a staged diff and flags duplicates/contradictions. */
export function integrityCheckerPrompt(): string {
  return [
    "You are an integrity auditor for a knowledge base diff. You have read-only tools:",
    "kb_search (keyword search), kb_read (read one file), kb_list (list a directory). Use them.",
    "",
    "You will be given a unified diff of proposed edits to markdown notes. Read only the added",
    "lines (lines starting with a single +, not the +++ file header).",
    "",
    "For each added section, identify its core claim or topic, then use kb_search to look for",
    "existing vault content on the same claim or topic. Read the most likely candidates with",
    "kb_read. For each real match, decide:",
    "- duplicate: the same fact or topic is already documented in an existing file.",
    "- contradiction: the added content conflicts with what an existing file already says.",
    "",
    "Only report a match you actually confirmed by reading the candidate file's content, not a",
    "guess from a search snippet alone. Do not report a match to a file the diff itself is",
    "editing (that is the same document, not a duplicate or a contradiction).",
    "",
    OUTPUT_CONTRACT,
    "Each message must name the related file's vault-relative path and explain, in one sentence,",
    "why it is a duplicate or a contradiction. Use severity warn for a confident match and info",
    "for a weaker, worth-a-second-look match.",
  ].join("\n");
}

function isRawFinding(x: unknown): x is { severity: AdvisorySeverity; message: string } {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (o.severity === "info" || o.severity === "warn") && typeof o.message === "string" && o.message.trim() !== "";
}

/**
 * Defensively parses an agent's free-text response as JSON lines. A line
 * that is not valid JSON, or whose shape does not match a finding, is
 * skipped rather than thrown on: a model that ignores the output contract
 * just degrades to fewer findings, never a crash.
 */
export function parseFindings(text: string, agent: AdvisoryAgentName): AdvisoryFinding[] {
  const findings: AdvisoryFinding[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRawFinding(parsed)) {
        findings.push({ agent, severity: parsed.severity, message: parsed.message });
      } else if (Array.isArray(parsed)) {
        // A plausible model failure mode: the whole response is one JSON
        // array instead of newline-delimited objects. Accept only the
        // well-shaped entries within it, same as the line-by-line path.
        for (const item of parsed) {
          if (isRawFinding(item)) findings.push({ agent, severity: item.severity, message: item.message });
        }
      }
    } catch {
      // Not JSON (stray prose, a fence marker, ...); skip this line only.
    }
  }
  return findings;
}

async function drainForResult(
  q: Query,
  onResult: (text: string) => void,
  onUsage: (msg: Extract<SDKMessage, { type: "result" }>) => void,
): Promise<void> {
  for await (const msg of q) {
    if (msg.type !== "result") continue;
    onUsage(msg);
    if (msg.subtype === "success") onResult(msg.result);
  }
}

interface AgentToolConfig {
  mcpServers: Record<string, ReturnType<typeof createKbReadOnlyMcpServer>>;
  allowedTools: string[];
  maxTurns: number;
}

/** Runs one judgment agent over `diff`; never rejects, resolves to `[]` on any failure. */
async function runAgent(
  agent: AdvisoryAgentName,
  systemPrompt: string,
  diff: string,
  toolConfig?: AgentToolConfig,
  threadId?: string,
): Promise<AdvisoryFinding[]> {
  try {
    let resultText = "";
    const q = query({
      prompt: `DIFF TO REVIEW:\n\n${diff}`,
      options: {
        model: MODEL,
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt },
        permissionMode: "bypassPermissions",
        // `tools` decides what EXISTS, `allowedTools` only what runs without a
        // prompt (SDK: "To restrict which tools are available, use the `tools`
        // option instead"). Listing the read tools in `allowedTools` alone left
        // the whole claude_code preset available here, Bash included, every one
        // auto-approved by bypassPermissions. The input to these agents is a
        // staged KB diff, so its text is not ours. Keep both lists identical,
        // the same way `lib/memory/dream.ts` does.
        tools: toolConfig?.allowedTools ?? [],
        allowedTools: toolConfig?.allowedTools ?? [],
        maxTurns: toolConfig?.maxTurns ?? 4,
        maxBudgetUsd: 0.5,
        env: resolveAgentEnv(),
        ...(toolConfig ? { mcpServers: toolConfig.mcpServers } : {}),
      },
    });
    await withTimeout(
      drainForResult(
        q,
        (text) => {
          resultText = text;
        },
        (msg) => {
          captureUsage(msg, {
            source: "quality",
            ownerEmail: ownerForThread(threadId),
            threadId: threadId ?? null,
          });
        },
      ),
      qualityAgentTimeoutMs(),
      () => {
        log.warn("[quality] agent timed out; interrupting", { agent });
        void q.interrupt().catch((interruptErr) => {
          log.error("[quality] agent interrupt failed", { agent, err: String(interruptErr) });
        });
      },
    );
    return parseFindings(resultText, agent);
  } catch (err) {
    log.error("[quality] agent query failed", { agent, err: String(err) });
    return [];
  }
}

/**
 * integrity-checker: unlike the other two agents, needs live read tools to
 * search the vault. `createKbReadOnlyMcpServer` runs before `runAgent`'s own
 * try/catch is entered, so this wraps the whole body itself: if server
 * construction throws synchronously, this still resolves to `[]` rather than
 * rejecting, preserving the module's never-throws contract.
 */
export async function runIntegrityChecker(diff: string, scopeRoot?: string, threadId?: string): Promise<AdvisoryFinding[]> {
  try {
    return await runAgent(
      "integrity-checker",
      integrityCheckerPrompt(),
      diff,
      {
        mcpServers: { kb: createKbReadOnlyMcpServer(scopeRoot) },
        allowedTools: ["mcp__kb__kb_search", "mcp__kb__kb_read", "mcp__kb__kb_list"],
        maxTurns: 8,
      },
      threadId,
    );
  } catch (err) {
    log.error("[quality] agent query failed", { agent: "integrity-checker", err: String(err) });
    return [];
  }
}

/**
 * Runs citation-checker, style-reviewer, and (when INTEGRITY_ENABLED)
 * integrity-checker over the whole staged diff and returns their combined
 * findings. `[]` when quality gates are off, the diff is empty or
 * whitespace, or every agent fails; never throws. Agents run concurrently:
 * each is independently timeout-bounded and error-isolated.
 */
export async function reviewStagedDiff(diff: string, scopeRoot?: string, threadId?: string): Promise<AdvisoryFinding[]> {
  if (!isQualityGatesEnabled() || !diff.trim()) return [];
  const checks: Promise<AdvisoryFinding[]>[] = [
    runAgent("citation-checker", citationCheckerPrompt(), diff, undefined, threadId),
    runAgent("style-reviewer", styleReviewerPrompt(), diff, undefined, threadId),
  ];
  if (isIntegrityEnabled()) checks.push(runIntegrityChecker(diff, scopeRoot, threadId));
  const results = await Promise.all(checks);
  return results.flat();
}
