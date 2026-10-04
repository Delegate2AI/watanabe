import { describe, it, expect } from "vitest";
import { governanceMarkdown } from "./governance";

describe("governanceMarkdown", () => {
  it("omits the house rules section when there are none", () => {
    const text = governanceMarkdown([]);
    expect(text).not.toContain("House rules");
    expect(text.startsWith("# Portal Memory Governance\n\n## Writing discipline")).toBe(true);
  });

  it("lists configured rules as bullets before the writing discipline", () => {
    const text = governanceMarkdown(["Say Acme in full.", "Never promise dates."]);
    expect(text).toContain("## House rules (always apply)\n- Say Acme in full.\n- Never promise dates.\n\n## Writing discipline");
  });
});
