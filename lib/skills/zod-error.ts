import type { z } from "zod";

/**
 * A readable one-line reason for a zod failure. `ZodError.message` is a
 * pretty-printed JSON blob of every issue, which is unusable in an admin list
 * or a log line, so the issues are flattened to "path: message" pairs instead.
 *
 * Shared by every spec 34 loader that reports a parse failure to an admin: the
 * registry (access/skills.yaml) and the marketplace index both surface these
 * strings verbatim in a UI.
 */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join(".");
      return at ? `${at}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
