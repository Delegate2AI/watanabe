export interface Utterance {
  speaker: string;
  text: string;
}

const SPEAKER_LINE = /^([^:\n]{1,80}):\s*(.*)$/;

function looksLikeSpeaker(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/);
  if (words.length === 0 || words.length > 6) return false;
  if (/[.!?]/.test(candidate)) return candidate.includes("@");
  return candidate.includes("@") || words.every((word) => /^[\p{Lu}\p{N}]/u.test(word));
}

export function parseUtterances(text: string): Utterance[] {
  const utterances: Utterance[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = SPEAKER_LINE.exec(line);
    const previous = utterances.at(-1);
    if (!match || !looksLikeSpeaker(match[1])) {
      if (previous) previous.text = `${previous.text} ${line}`.trim();
      else utterances.push({ speaker: "Unknown", text: line });
      continue;
    }
    const speaker = match[1].trim() || "Unknown";
    const said = match[2].trim();
    if (previous && previous.speaker === speaker) {
      previous.text = `${previous.text} ${said}`.trim();
      continue;
    }
    utterances.push({ speaker, text: said });
  }
  return utterances.filter((utterance) => utterance.text.length > 0);
}

export function formatTranscript(text: string): string {
  const utterances = parseUtterances(text);
  if (utterances.length === 0) return text.trim();
  return utterances.map((utterance) => `**${utterance.speaker}:** ${utterance.text}`).join("\n\n");
}
