/**
 * GitLab executes "quick actions" (`/merge`, `/approve`, `/close`,
 * `/target_branch`, `/label`, ...) found on their own line-leading position
 * in an MR description created via the REST API, acting as whatever token
 * created the MR — here, the bot's `REPO_WRITE_TOKEN`. `lib/packages/runner.ts`
 * passes the agent's own report (built by summarizing an UNTRUSTED uploaded
 * package) straight into `createMergeRequest`'s `description` field, so a
 * package crafted to make the agent's report end a line with `/merge` would
 * otherwise let the uploader auto-approve/merge/close/relabel their own
 * package's MR without ever going through human review — a prompt-injection
 * path around the review gate this whole feature exists to enforce.
 *
 * Only a LINE-LEADING slash-command (optionally indented — GitLab tolerates
 * leading whitespace before a quick action) is neutralized; a slash anywhere
 * else in a line (a URL, a path in prose, a fraction) is left untouched.
 */
const QUICK_ACTION_LINE = /^(\s*)\/([a-z_]+)/i;

/** Neutralize every line-leading GitLab quick action in `report` so it renders literally instead of executing. */
export function sanitizeMrDescription(report: string): string {
  return report
    .split("\n")
    .map((line) => {
      const match = QUICK_ACTION_LINE.exec(line);
      if (!match) return line;
      const [, leadingWhitespace] = match;
      // Insert a backslash right before the slash — GitLab renders `\/merge`
      // as the literal text `/merge` instead of executing it, same escape
      // convention as any other markdown special character.
      return leadingWhitespace + "\\" + line.slice(leadingWhitespace.length);
    })
    .join("\n");
}
