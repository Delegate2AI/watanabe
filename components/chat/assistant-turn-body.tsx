import { memo } from "react";
import type { AssistantTurn } from "@/lib/agent/conversation";
import { Markdown } from "@/components/ui/markdown";
import { SourceCard } from "./source-card";
import { TurnActivity } from "./turn-activity";
import { sourceRefs } from "./tool-cards";

/**
 * The body of one assistant turn in the live transcript (spec 24): its streamed
 * text, the KB citations it grounded on (rendered as SourceCards beneath the
 * prose), and a lightweight error line when the turn failed. Thinking segments
 * and raw tool pills are intentionally not surfaced here: the new chat surface
 * shows the answer plus its sources, not the agent's scratch work.
 *
 * While the turn is streaming it also carries a live activity line (see
 * `TurnActivity`). It renders for the whole streaming turn, not only before the
 * first token: a long tool phase AFTER some text has streamed used to report
 * nothing at all, which is the case that looks hung.
 *
 * Memoized on `turn`. `applyEvent` folds a stream event into a NEW turn object
 * and leaves every other turn's identity untouched, so this boundary means only
 * the turn actually being written re-renders while an answer streams.
 */
export const AssistantTurnBody = memo(function AssistantTurnBody({
  turn,
}: {
  turn: AssistantTurn;
}) {
  const text = turn.segments
    .filter((s) => s.kind === "text")
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("");
  const sources = sourceRefs(turn);

  return (
    <div>
      {text && (
        <div className="mb-3">
          <Markdown>{text}</Markdown>
        </div>
      )}
      {turn.status === "streaming" && <TurnActivity turn={turn} />}
      {sources.map((s) => (
        <SourceCard key={s.path} path={s.path} visibility={s.visibility} />
      ))}
      {turn.status === "error" && (
        <p className="text-sm text-warn" role="alert">
          {turn.error ?? "Something went wrong."}
        </p>
      )}
    </div>
  );
});
