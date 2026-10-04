// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectDocuments } from "./project-documents";
import type { ProjectDocument } from "@/lib/db/project-docs";

const fetchMock = vi.fn();
const notifyFailure = vi.fn();
const notifySuccess = vi.fn();
vi.mock("@/lib/ui/toast", () => ({
  notifyFailure: (...args: unknown[]) => notifyFailure(...args),
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
}));

function doc(id: string, overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id,
    projectId: "p1",
    filename: `${id}.pdf`,
    contentType: "application/pdf",
    byteSize: 2048,
    uploaderEmail: "alice@example.com",
    createdAt: "2026-07-12T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  notifyFailure.mockReset();
  notifySuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ProjectDocuments", () => {
  it("lists existing documents with a human size", () => {
    render(<ProjectDocuments projectId="p1" initialDocuments={[doc("d1", { filename: "spec.pdf" })]} />);
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("links the filename to the project-scoped download route", () => {
    render(<ProjectDocuments projectId="p1" initialDocuments={[doc("d1", { filename: "spec.pdf" })]} />);
    expect(screen.getByRole("link", { name: "spec.pdf" })).toHaveAttribute(
      "href",
      "/api/projects/p1/documents/d1",
    );
  });

  it("names the uploader and when the document landed", () => {
    const { container } = render(
      <ProjectDocuments
        projectId="p1"
        initialDocuments={[doc("d1")]}
        people={{
          "alice@example.com": {
            email: "alice@example.com",
            name: "Alice Chen",
            initials: "AC",
            isSelf: false,
          },
        }}
      />,
    );
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    // The rendered label is relative and moves with the clock, so the assertion
    // is on the machine-readable stamp and on the absolute value kept on hover.
    const stamp = container.querySelector('time[datetime="2026-07-12T00:00:00Z"]');
    expect(stamp).not.toBeNull();
    expect(stamp?.getAttribute("title")).toContain("Jul 2026");
  });

  it("offers an inline preview for markdown and a download for everything else", () => {
    render(
      <ProjectDocuments
        projectId="p1"
        initialDocuments={[
          doc("d1", { filename: "notes.md", contentType: "text/markdown" }),
          doc("d2", { filename: "deck.pdf" }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Preview notes.md" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download deck.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview deck.pdf" })).toBeNull();
  });

  it("uploads a file and prepends it to the list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ document: doc("new", { filename: "uploaded.pdf" }) }),
    });
    render(<ProjectDocuments projectId="p1" initialDocuments={[]} />);
    const file = new File(["hello"], "uploaded.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Upload a document"), file);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/p1/documents");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(await screen.findByText("uploaded.pdf")).toBeInTheDocument();
  });

  it("reports an upload failure through the toast path and adds no row", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { code: "invalid_request" } }) });
    render(<ProjectDocuments projectId="p1" initialDocuments={[]} />);
    await userEvent.upload(
      screen.getByLabelText("Upload a document"),
      new File(["x"], "too-big.pdf", { type: "application/pdf" }),
    );
    await waitFor(() =>
      expect(notifyFailure).toHaveBeenCalledWith("That request was not valid. Check the form and try again."),
    );
    expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument();
  });

  it("removes a document", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<ProjectDocuments projectId="p1" initialDocuments={[doc("d1", { filename: "spec.pdf" })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove spec.pdf" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/documents",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ documentId: "d1" }) }),
    );
    expect(screen.queryByText("spec.pdf")).not.toBeInTheDocument();
  });
});
