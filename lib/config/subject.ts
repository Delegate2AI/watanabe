import { getConfig } from "./index";

export function subjectPrefix(): string {
  const subject = getConfig().agent.subjectName;
  return subject ? `${subject} ` : "";
}
