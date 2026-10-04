// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const notifyFailureMock = vi.fn();
const notifySuccessMock = vi.fn();
vi.mock("@/lib/ui/toast", () => ({
  notifyFailure: (...args: unknown[]) => notifyFailureMock(...args),
  notifySuccess: (...args: unknown[]) => notifySuccessMock(...args),
}));

import { DesignGuideAdmin } from "./design-guide-admin";

/**
 * The admin surface for the house style.
 *
 * The two properties worth pinning: "Try it" runs what is in the BOX, not what
 * was saved, which is the entire reason the button exists; and a refusal names
 * the line, because an admin cannot find a bad line in a 3kB text area by being
 * told the guide is invalid.
 */

const BUILT_IN = "HOUSE STYLE\n\nOne accent colour.";
const SAMPLE = "<!doctype html><html><body><h1>Northwind</h1></body></html>";

function renderAdmin(source: "stored" | "default" = "default", text = BUILT_IN) {
  return render(
    <DesignGuideAdmin
      guide={{ text, source }}
      builtIn={BUILT_IN}
      constraints="HARD CONSTRAINTS. No external assets."
      maxBytes={16_000}
    />,
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  notifyFailureMock.mockReset();
  notifySuccessMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

function bad(status: number, body: unknown) {
  return { ok: false, status, json: async () => body };
}

describe("DesignGuideAdmin", () => {
  it("shows the guide in force and says where it came from", () => {
    renderAdmin("default");
    expect(screen.getByRole("textbox", { name: "Design guide" })).toHaveValue(BUILT_IN);
    expect(screen.getByText(/Currently using the built-in guide/i)).toBeInTheDocument();
  });

  it("cannot save until something changed", async () => {
    renderAdmin();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Design guide" }), " Wide margins.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves the edited text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderAdmin();
    await userEvent.type(screen.getByRole("textbox", { name: "Design guide" }), " Wide.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/design-guide");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).text).toContain("Wide.");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("names the offending line when a save is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        bad(400, { error: { code: "invalid_request" }, problems: [{ line: 7, reason: "no script" }] }),
      ),
    );
    renderAdmin();
    await userEvent.type(screen.getByRole("textbox", { name: "Design guide" }), " x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("line 7");
    expect(alert).toHaveTextContent("no script");
  });

  it("previews the UNSAVED text, which is the whole point of the button", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ html: SAMPLE }));
    vi.stubGlobal("fetch", fetchMock);
    renderAdmin("stored", "HOUSE STYLE\n\nSaved version.");

    await userEvent.type(screen.getByRole("textbox", { name: "Design guide" }), " Unsaved edit.");
    await userEvent.click(screen.getByRole("button", { name: "Try it" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/design-guide/preview");
    expect(JSON.parse(init.body).text).toContain("Unsaved edit.");
  });

  it("renders the sample once it arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ html: SAMPLE })));
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Try it" }));
    // An iframe, because the sample is model-authored markup and goes through
    // the same sandboxed viewer the canvas uses.
    await waitFor(() => expect(screen.getByTitle("Sample document")).toBeInTheDocument());
  });

  it("reports a failed preview in the panel rather than leaving it spinning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bad(502, { error: { code: "internal" } })));
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Try it" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByTitle("Sample document")).not.toBeInTheDocument();
  });

  it("restores the built-in guide into the editor without saving it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderAdmin("stored", "HOUSE STYLE\n\nSomething an admin regrets.");
    await userEvent.click(screen.getByRole("button", { name: /restore built-in/i }));
    expect(screen.getByRole("textbox", { name: "Design guide" })).toHaveValue(BUILT_IN);
    // Loading the text is not committing it: the admin still presses Save.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the fixed half on request, so an admin can see the whole instruction", async () => {
    renderAdmin();
    expect(screen.queryByText(/No external assets/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show the fixed half/i }));
    expect(screen.getByText(/No external assets/)).toBeInTheDocument();
  });
});
