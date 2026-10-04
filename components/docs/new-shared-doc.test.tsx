// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewSharedDoc } from "./new-shared-doc";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "doc-1" }) })));
});

describe("NewSharedDoc", () => {
  it("creates a document and opens it, where the sharing controls live", async () => {
    const user = userEvent.setup();
    render(<NewSharedDoc />);

    await user.click(screen.getByRole("button", { name: /New document/ }));
    await user.type(screen.getByLabelText(/^Title/), "Tier review");
    await user.type(screen.getByLabelText(/First paragraph/), "Opening thoughts.");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/docs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Tier review", body: "Opening thoughts." }),
      }),
    );
    expect(push).toHaveBeenCalledWith("/docs/doc-1");
  });

  // The route rejects an empty body, so an untouched paragraph field must not
  // turn "create a document" into a validation error.
  it("seeds a body from the title when no paragraph is written", async () => {
    const user = userEvent.setup();
    render(<NewSharedDoc />);

    await user.click(screen.getByRole("button", { name: /New document/ }));
    await user.type(screen.getByLabelText(/^Title/), "Tier review");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/docs",
      expect.objectContaining({ body: JSON.stringify({ title: "Tier review", body: "# Tier review\n" }) }),
    );
  });

  it("refuses to submit without a title", async () => {
    const user = userEvent.setup();
    render(<NewSharedDoc />);

    await user.click(screen.getByRole("button", { name: /New document/ }));
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
