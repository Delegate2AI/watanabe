import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { resolveAgentEnv } from "@/lib/agent/auth";
import { composeDesignPrompt } from "@/lib/agent/design-prompt";
import { log } from "@/lib/log";
import { withTimeout } from "@/lib/memory/timeout";
import { captureUsage } from "@/lib/usage/capture";

/**
 * "Try it": one document written against a candidate guide, so an admin can see
 * what an edit does before saving it.
 *
 * Text in a box whose effect shows up three chat turns later is not a loop
 * anybody can edit against. This runs the CANDIDATE guide, not the stored one,
 * which is the whole point: the answer arrives before the commit.
 *
 * A bounded headless query in the idiom of `lib/quality/agents.ts`: no tools, no
 * MCP servers, one turn, a cost ceiling and a timeout. Never throws.
 *
 * It stops at the HTML. No sidecar, so the loop still works when the renderer is
 * down, and the returned markup is handed to the same `HtmlDocument` viewer the
 * canvas uses, which sanitizes it. There is deliberately no second notion here
 * of what a safe document is.
 */

const MODEL = process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8";

const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000;

function previewTimeoutMs(): number {
  const raw = process.env.DESIGN_PREVIEW_TIMEOUT_MS?.trim();
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PREVIEW_TIMEOUT_MS;
}

/**
 * The same brief every time, so two runs differ because the guide differs.
 *
 * It carries its own figures because the guidance forbids drawing a number
 * nobody supplied, and it names the shapes a house style has opinions about: a
 * masthead, a chart, a metadata grid, one section that wants emphasis. The
 * subject is openly invented so a sample can never be mistaken for a record.
 */
export const SAMPLE_BRIEF = [
  "Write this as a single designed document. Output the document only.",
  "",
  "Title: Northwind Ferry, summer service review",
  "Kicker: Operations briefing",
  "Standfirst: A short review of the 2026 summer timetable. Every figure below is",
  "invented for this sample document.",
  "",
  "1. WHERE THE TIME GOES. Average delay by route, in minutes: Harbour Line 4.2,",
  "   Cross-Bay 11.8, Night Service 2.1, Island Hopper 7.5. Draw this as a chart.",
  "",
  "2. WHAT CHANGED. Passengers carried per month, in thousands: May 61, June 74,",
  "   July 96, August 92. Draw this as a chart too, in a different shape from the",
  "   one above.",
  "",
  "3. THE ONE THING TO FIX. Cross-Bay carries most of the delay and a third of the",
  "   complaints. This is the section that matters most.",
  "",
  "4. Metadata, as a grid: Period, May to August 2026. Prepared by, Operations.",
  "   Status, Sample. Next review, October 2026.",
  "",
  "Close with a short colophon line saying this is a sample document.",
].join("\n");

const OUTPUT_CONTRACT = [
  "",
  "OUTPUT. Reply with the HTML document and nothing else. Start at <!doctype html>",
  "and end at </html>. No preamble, no explanation, no markdown fence.",
].join("\n");

export type DesignPreviewResult = { ok: true; html: string } | { ok: false; error: string };

/**
 * How many previews may be in flight at once, process-wide.
 *
 * The route is admin-gated and each call carries its own cost ceiling, but
 * neither of those bounds the NUMBER of calls: a held-down button or a loop
 * against the endpoint spawns one model subprocess per request. The button's
 * disabled state is client-side and protects nothing. Two is enough for an
 * admin comparing two edits and small enough that a loop gets refused rather
 * than served.
 */
const MAX_CONCURRENT_PREVIEWS = 2;

// A holder object, not a `let`: prefer-const's autofix rewrites a binding whose
// only reassignments live further down the file, and a const cannot count.
const running = { count: 0 };

/** From `<!doctype`/`<html` to the end, with a markdown fence removed if one crept in. */
export function extractDocument(text: string): string {
  const unfenced = text.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  const start = /<!doctype\s+html|<html[\s>]/i.exec(unfenced);
  return start ? unfenced.slice(start.index).trim() : unfenced.trim();
}

async function drainForResult(q: Query): Promise<string> {
  let result = "";
  for await (const message of q) {
    if (message.type !== "result") continue;
    captureUsage(message, { source: "design", ownerEmail: null, threadId: null });
    if (message.subtype === "success") result = message.result;
  }
  return result;
}

/**
 * Render the sample brief against `houseStyle`. Resolves to a refusal rather
 * than rejecting: this is an admin pressing a button, and a model that timed out
 * is a thing to report in the panel, not an exception.
 */
export async function previewDesignGuide(houseStyle: string): Promise<DesignPreviewResult> {
  if (running.count >= MAX_CONCURRENT_PREVIEWS) return { ok: false, error: "busy" };
  running.count += 1;
  try {
    const q = query({
      prompt: SAMPLE_BRIEF,
      options: {
        model: MODEL,
        settingSources: [],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: composeDesignPrompt(houseStyle) + OUTPUT_CONTRACT,
        },
        permissionMode: "bypassPermissions",
        // `tools`, not just `allowedTools`, and the difference is the whole
        // safety of this call. `allowedTools` only auto-approves (SDK: "To
        // restrict which tools are available, use the `tools` option instead"),
        // so an empty list there left the full claude_code preset available:
        // Bash, Read, Write, Edit, every one auto-approved by
        // bypassPermissions, with `cwd` defaulting to the app root. The prompt
        // this runs is admin-authored text from a web form, so that turned an
        // editor box into command execution. `tools: []` is what removes them.
        // Same lever, same reasoning as `lib/memory/dream.ts`.
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        maxBudgetUsd: 1,
        env: resolveAgentEnv(),
      },
    });
    let text = "";
    await withTimeout(
      drainForResult(q).then((result) => {
        text = result;
      }),
      previewTimeoutMs(),
      () => {
        log.warn("[design-guide] preview timed out; interrupting");
        void q.interrupt().catch((err) => {
          log.error("[design-guide] preview interrupt failed", { err: String(err) });
        });
      },
    );
    const html = extractDocument(text);
    if (html === "") return { ok: false, error: "empty" };
    return { ok: true, html };
  } catch (err) {
    log.error("[design-guide] preview failed", { err: String(err) });
    return { ok: false, error: "failed" };
  } finally {
    running.count -= 1;
  }
}
