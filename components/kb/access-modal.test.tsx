// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessModal } from "./access-modal";

const groups = ["all-hands", "marketing", "finance"];

function stubFetch(payload: { visibility?: string[]; mixed?: boolean }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccessModal", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("fetches and pre-checks the current visibility for a file", async () => {
    const fetchMock = stubFetch({ visibility: ["all-hands"], mixed: false });
    render(<AccessModal path="09-finance/model.md" isDirectory={false} groups={groups} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText("all-hands")).toBeChecked());
    expect(fetchMock).toHaveBeenCalledWith("/api/kb/access?path=09-finance%2Fmodel.md");
    expect(screen.getByLabelText("marketing")).not.toBeChecked();
  });

  it("fetches a folder's aggregate visibility and pre-checks the shared groups", async () => {
    const fetchMock = stubFetch({ visibility: ["all-hands"], mixed: false });
    render(<AccessModal path="09-finance" isDirectory groups={groups} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText("all-hands")).toBeChecked());
    expect(fetchMock).toHaveBeenCalledWith("/api/kb/access?path=09-finance");
    expect(screen.queryByText(/different access/i)).not.toBeInTheDocument();
  });

  it("warns when a folder's files have differing access", async () => {
    stubFetch({ visibility: [], mixed: true });
    render(<AccessModal path="09-finance" isDirectory groups={groups} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/different access/i)).toBeInTheDocument());
    expect(screen.getByLabelText("all-hands")).not.toBeChecked();
  });

  it("links the change request when the save opened one for review", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ visibility: ["all-hands"], mixed: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branch: "kb/a/setvis", mrUrl: "https://git.example.com/mr/9", count: 2, skipped: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccessModal path="09-finance" isDirectory groups={groups} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("all-hands")).toBeChecked());

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("link", { name: "Open merge request" })).toHaveAttribute("href", "https://git.example.com/mr/9");
    expect(screen.getByText(/submitted for review/i)).toBeInTheDocument();
  });

  it("reports a direct write as applied, with no review link", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ visibility: ["all-hands"], mixed: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branch: "main", count: 1, skipped: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccessModal path="09-finance/model.md" isDirectory={false} groups={groups} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("all-hands")).toBeChecked());

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/updated 1 file/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
