import { describe, expect, it } from "vitest";
import { buildNavSections } from "./sidebar-nav";

function hrefs(visibility: Parameters<typeof buildNavSections>[0]): string[] {
  return buildNavSections(visibility).flatMap((s) => s.children.map((c) => c.href));
}

describe("LLM keys nav entries", () => {
  it("are absent while the layout resolves neither flag", () => {
    expect(hrefs({ showAdmin: true, showMcp: true })).not.toContain("/settings/llm");
    expect(hrefs({ showAdmin: true })).not.toContain("/admin/llm");
  });

  it("puts the personal page under Integrations and the budgets under Administration", () => {
    const sections = buildNavSections({ showLlmKeys: true, showLlmAdmin: true });
    const where = (href: string) => sections.find((s) => s.children.some((c) => c.href === href))?.id;
    expect(where("/settings/llm")).toBe("integrations");
    expect(where("/admin/llm")).toBe("administration");
  });
});
