/**
 * One file's unified diff, as GitLab returned it. The reviewable artifact is the
 * diff itself, so nothing here parses markdown or renders the note.
 */

type LineKind = "added" | "removed" | "hunk" | "context";

/** The `---`/`+++` header lines name paths the card already lists above. */
const FILE_HEADER = /^(\+\+\+|---)( |$)/;

const LINE_CLASS: Record<LineKind, string> = {
  added: "bg-good-soft text-good",
  removed: "bg-warn-soft text-warn",
  hunk: "text-ink-faint",
  context: "text-ink-muted",
};

function kindOf(line: string): LineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n").filter((line) => !FILE_HEADER.test(line));
  // A trailing newline leaves one empty line that carries no information.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  if (lines.length === 0) {
    return <p className="px-3 py-2 text-xs text-ink-faint">No textual diff for this file.</p>;
  }

  return (
    <pre className="overflow-x-auto rounded-card border border-line bg-surface-2 py-2 text-xs leading-5 [font-family:ui-monospace,SFMono-Regular,Menlo,monospace]">
      <code className="block min-w-full">
        {lines.map((line, index) => (
          <span
            key={index}
            className={`block whitespace-pre px-3 ${LINE_CLASS[kindOf(line)]}`}
          >
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}
