
export const MAX_MR_TITLE = 255;

export interface MergeRequestText {
  title: string;
  description: string;
}

export function splitMergeRequestTitle(commitMessage: string, description: string): MergeRequestText {
  const normalized = commitMessage.replace(/\r\n/g, "\n");
  const [subjectLine, ...rest] = normalized.split("\n");
  const subject = subjectLine.trim();
  const body = rest.join("\n").trim();

  const title = subject.length === 0
    ? "Knowledge base update"
    : subject.length <= MAX_MR_TITLE
      ? subject
      : `${subject.slice(0, MAX_MR_TITLE - 3)}...`;

  const whole = normalized.trim();
  const carried = title === whole ? "" : title === subject ? body : whole;
  return { title, description: carried ? `${carried}\n\n${description}` : description };
}
