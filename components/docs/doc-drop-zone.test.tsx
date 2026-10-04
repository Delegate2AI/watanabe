// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocDropZone } from "./doc-drop-zone";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

function file(name: string, text = "# hi") {
  return new File([text], name, { type: "text/markdown" });
}

/** A drop event carrying files, which jsdom does not synthesize on its own. */
function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ["Files"], items: [] };
  fireEvent.drop(target, { dataTransfer });
}

function ok(body: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", ok({ id: "doc-1", title: "Q3 plan", droppedImages: 0 }));
});

describe("DocDropZone", () => {
  it("uploads a dropped file and opens the document it created", async () => {
    render(<DocDropZone><p>the list</p></DocDropZone>);
    dropFiles(screen.getByTestId("doc-drop-zone"), [file("Q3 plan.md")]);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/docs/doc-1"));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/docs/import");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(((init as RequestInit).body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("imports the first of several dropped files and stays put to say the others were skipped", async () => {
    render(<DocDropZone><p>the list</p></DocDropZone>);
    dropFiles(screen.getByTestId("doc-drop-zone"), [file("one.md"), file("two.md"), file("three.md")]);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/2 other files were not imported/)).toBeInTheDocument();
    // Redirecting would take the notice off the screen with it.
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: "Q3 plan" })).toBeInTheDocument();
  });

  it("does not claim images were left out when none were", async () => {
    render(<DocDropZone><p>the list</p></DocDropZone>);
    dropFiles(screen.getByTestId("doc-drop-zone"), [file("one.md"), file("two.md")]);

    expect(await screen.findByText(/1 other file was not imported/)).toBeInTheDocument();
    expect(screen.queryByText(/left out/)).not.toBeInTheDocument();
  });

  it("ignores a second file while the first is still uploading", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await pending;
        return { ok: true, json: async () => ({ id: "doc-1", title: "Q3 plan", droppedImages: 0 }) };
      }),
    );
    render(<DocDropZone><p>the list</p></DocDropZone>);
    const zone = screen.getByTestId("doc-drop-zone");
    dropFiles(zone, [file("one.md")]);
    await screen.findByText(/Importing one.md/);
    dropFiles(zone, [file("two.md")]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Upload/ })).toBeDisabled();
    release(null);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/docs/doc-1"));
  });

  it("reports what was left out instead of redirecting past it", async () => {
    vi.stubGlobal("fetch", ok({ id: "doc-9", title: "Brief", droppedImages: 2 }));
    render(<DocDropZone><p>the list</p></DocDropZone>);
    dropFiles(screen.getByTestId("doc-drop-zone"), [file("brief.docx")]);

    expect(await screen.findByText(/2 images were left out/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Brief" })).toHaveAttribute("href", "/docs/doc-9");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the mapped copy for a refused file, and no copy of its own", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: { code: "unsupported_file" } }) })),
    );
    render(<DocDropZone><p>the list</p></DocDropZone>);
    dropFiles(screen.getByTestId("doc-drop-zone"), [file("sheet.xlsx")]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot be imported/);
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels dragenter and dragover, without which the browser refuses the drop", () => {
    render(<DocDropZone><p>the list</p></DocDropZone>);
    const zone = screen.getByTestId("doc-drop-zone");
    const dataTransfer = { files: [], types: ["Files"], items: [] };

    const enter = fireEvent.dragEnter(zone, { dataTransfer });
    const over = fireEvent.dragOver(zone, { dataTransfer });
    // fireEvent returns false when a handler called preventDefault.
    expect(enter).toBe(false);
    expect(over).toBe(false);
    expect(screen.getByText(/Drop to import/)).toBeInTheDocument();
  });

  it("leaves a text drag alone, so selecting text does not raise a drop target", () => {
    render(<DocDropZone><p>the list</p></DocDropZone>);
    const zone = screen.getByTestId("doc-drop-zone");
    fireEvent.dragEnter(zone, { dataTransfer: { files: [], types: ["text/plain"], items: [] } });
    expect(screen.queryByText(/Drop to import/)).not.toBeInTheDocument();
  });

  it("imports from the button too, since a drop target is unreachable by keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<DocDropZone><p>the list</p></DocDropZone>);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.accept).toContain(".docx");

    await user.upload(input, file("typed.md"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/docs/doc-1"));
    expect(screen.getByRole("button", { name: /Upload/ })).toBeInTheDocument();
  });

  it("renders the Upload button in the header row beside the page actions", () => {
    render(
      <DocDropZone header={<h1>Shared with people</h1>} actions={<button type="button">New document</button>}>
        <p>the list</p>
      </DocDropZone>,
    );
    const upload = screen.getByRole("button", { name: /Upload/ });
    const create = screen.getByRole("button", { name: "New document" });
    // Same header row, and outside the drop target so a drop cannot hit them.
    expect(upload.parentElement).toBe(create.parentElement);
    expect(screen.getByTestId("doc-drop-zone")).not.toContainElement(upload);
  });
});
