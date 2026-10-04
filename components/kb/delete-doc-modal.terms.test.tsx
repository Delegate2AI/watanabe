// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeleteDocModal } from "./delete-doc-modal";
import { AppConfigProvider } from "@/components/app-config-provider";
import { PortalConfigSchema } from "@/lib/config/schema";
import { toPublicConfig } from "@/lib/config/public";
import { GITHUB_TERMS } from "@/lib/git-host/terms";

describe("DeleteDocModal change request wording", () => {
  it("says merge request by default", () => {
    render(<DeleteDocModal path="docs/a.md" onClose={() => {}} />);
    expect(screen.getByText(/This opens a merge request removing the document/)).toBeTruthy();
  });

  it("says pull request under a GitHub deploy", () => {
    const config = toPublicConfig(PortalConfigSchema.parse({}), GITHUB_TERMS);
    render(
      <AppConfigProvider config={config}>
        <DeleteDocModal path="docs/a.md" onClose={() => {}} />
      </AppConfigProvider>,
    );
    expect(screen.getByText(/This opens a pull request removing the document/)).toBeTruthy();
    expect(screen.queryByText(/merge request/)).toBeNull();
  });
});
