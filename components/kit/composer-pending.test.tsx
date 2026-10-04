// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { Composer } from "./composer";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Composer while an attachment is still uploading", () => {
  it("disables send until the mint and upload settle", async () => {
    let releaseMint!: () => void;
    const mintGate = new Promise<void>((r) => (releaseMint = r));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/threads") {
        await mintGate;
        return jsonResponse({ id: "minted-1" });
      }
      return jsonResponse({
        attachment: { type: "attachment", id: "u1", name: "a.txt", mimeType: "text/plain", size: 1, threadId: "minted-1" },
      });
    });

    const onSubmit = vi.fn();
    const { container } = render(<Composer onSubmit={onSubmit} attachmentsEnabled />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "look at this" } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["a"], "a.txt", { type: "text/plain" })] } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      releaseMint();
      await mintGate;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });
});
