// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { messageFor } from "@/lib/errors/messages";
import type { Proposal } from "@/lib/review/queue";
import { ProposalList } from "./proposal-list";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function proposal(iid: number, over: Partial<Proposal> = {}): Proposal {
  return {
    iid,
    title: `Proposal ${iid}`,
    proposer: "alice@example.com",
    createdAt: "2026-08-18T10:00:00Z",
    webUrl: `https://gl.example.com/mr/${iid}`,
    sourceBranch: `kb/alice/x-${iid}`,
    paths: [`docs/note-${iid}.md`],
    changes: [
      {
        oldPath: `docs/note-${iid}.md`,
        newPath: `docs/note-${iid}.md`,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
      },
    ],
    origin: "chat",
    ...over,
  };
}

const VIEWER = { email: "boss@example.com", name: "Boss Person" };

const fetchMock = vi.fn();

beforeEach(() => {
  refreshMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("ProposalList", () => {
  it("renders one card per proposal, with its paths", () => {
    render(<ProposalList proposals={[proposal(1), proposal(2)]} viewer={VIEWER} />);

    expect(screen.getByText("Proposal 1")).toBeInTheDocument();
    expect(screen.getByText("Proposal 2")).toBeInTheDocument();
    expect(screen.getByText("docs/note-2.md")).toBeInTheDocument();
  });

  it("marks the card the viewer proposed themselves", () => {
    render(
      <ProposalList
        proposals={[proposal(1, { proposer: "boss@example.com" }), proposal(2)]}
        viewer={VIEWER}
      />,
    );
    expect(screen.getAllByText(/you proposed this/i)).toHaveLength(1);
  });

  it("shows the queue error state when the proposals could not be loaded", () => {
    render(<ProposalList proposals={[]} viewer={VIEWER} loadFailed />);

    expect(screen.getByRole("alert")).toHaveTextContent(messageFor("review_unavailable"));
    // An unreadable queue must never read as an empty one.
    expect(screen.queryByText(/nothing is waiting/i)).toBeNull();
  });

  it("says the queue is empty when nothing is waiting", () => {
    render(<ProposalList proposals={[]} viewer={VIEWER} />);
    expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument();
  });

  it("posts the decision and drops the card once it lands", async () => {
    fetchMock.mockResolvedValue(ok());
    render(<ProposalList proposals={[proposal(1), proposal(2)]} viewer={VIEWER} />);

    await userEvent.click(screen.getAllByRole("button", { name: /^approve$/i })[0]);

    await waitFor(() => expect(screen.queryByText("Proposal 1")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/review/1",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "approve" }) }),
    );
    expect(screen.getByText("Proposal 2")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("closes the merge request through the same endpoint on reject", async () => {
    fetchMock.mockResolvedValue(ok());
    render(<ProposalList proposals={[proposal(3)]} viewer={VIEWER} />);

    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/review/3",
        expect.objectContaining({ body: JSON.stringify({ action: "reject" }) }),
      ),
    );
  });

  it("disables every action while one decision is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { release = resolve; }));
    render(<ProposalList proposals={[proposal(1), proposal(2)]} viewer={VIEWER} />);

    await userEvent.click(screen.getAllByRole("button", { name: /^approve$/i })[0]);

    await waitFor(() => {
      for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    });

    release(ok());
    await waitFor(() => expect(screen.queryByText("Proposal 1")).toBeNull());
  });

  it("keeps the card and reports the refusal when the action fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "needs_role" } }), { status: 403 }),
    );
    render(<ProposalList proposals={[proposal(1)]} viewer={VIEWER} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messageFor("needs_role"));
    expect(screen.getByText("Proposal 1")).toBeInTheDocument();
  });

  it("tells the approver to open the merge request when GitLab refused the merge", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "conflict", detail: "merge_refused" } }),
        { status: 409 },
      ),
    );
    render(<ProposalList proposals={[proposal(1)]} viewer={VIEWER} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/open the merge request/i);
    // The server never forwards GitLab's own sentence, so the copy must not
    // pretend to quote one, and the proposal stays queued.
    expect(alert).not.toHaveTextContent(messageFor("conflict"));
    expect(screen.getByText("Proposal 1")).toBeInTheDocument();
  });

  it("names the pull request in the refused-merge copy on a GitHub deploy", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "conflict", detail: "merge_refused" } }),
        { status: 409 },
      ),
    );
    render(
      <ProposalList
        proposals={[proposal(1)]}
        viewer={VIEWER}
        terms={{ short: "PR", long: "pull request" }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/open the pull request/i);
  });

  it("reports a network failure rather than dropping the card", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ProposalList proposals={[proposal(1)]} viewer={VIEWER} />);

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Proposal 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });
});
