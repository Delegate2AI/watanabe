// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VersionViewer } from "./version-viewer";
import type { ArtifactVersion } from "@/lib/db/artifacts";

function version(body: string): ArtifactVersion {
  return {
    id: "v1",
    artifactId: "a1",
    version: 3,
    body,
    format: "md",
    createdAt: "2026-07-12T18:10:38.000Z",
  } as ArtifactVersion;
}

describe("VersionViewer", () => {
  it("renders the version body as markdown, not raw source", () => {
    render(<VersionViewer version={version("## Section\n\n**Meridian** rules.")} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Section" }).tagName).toBe("H2");
    expect(screen.getByText("Meridian").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*Meridian\*\*/)).not.toBeInTheDocument();
  });

  it("shows the version number and closes on the close button", async () => {
    const onClose = vi.fn();
    render(<VersionViewer version={version("hi")} onClose={onClose} />);
    expect(screen.getByText("Version 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /close version viewer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
