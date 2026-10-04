// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Proposal } from "@/lib/review/queue";
import { ProposalCard, isSelfProposal } from "./proposal-card";

const PROPOSAL: Proposal = {
  iid: 7,
  title: "Add the desk handbook",
  proposer: "alice@example.com",
  createdAt: "2026-08-18T10:00:00Z",
  webUrl: "https://gl.example.com/mr/7",
  sourceBranch: "kb/alice/handbook",
  paths: ["docs/desk/handbook.md"],
  changes: [
    {
      oldPath: "docs/desk/handbook.md",
      newPath: "docs/desk/handbook.md",
      diff: "@@ -1 +1 @@\n-old\n+new\n",
      newFile: false,
      deletedFile: false,
      renamedFile: false,
    },
  ],
  origin: "chat",
};

function renderCard(over: Partial<Parameters<typeof ProposalCard>[0]> = {}) {
  const onDecide = vi.fn();
  render(
    <ProposalCard
      proposal={PROPOSAL}
      isSelf={false}
      busy={false}
      onDecide={onDecide}
      {...over}
    />,
  );
  return onDecide;
}

describe("ProposalCard", () => {
  it("shows the title, the proposer, the changed paths and the diff", () => {
    renderCard();

    expect(screen.getByText("Add the desk handbook")).toBeInTheDocument();
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("docs/desk/handbook.md")).toBeInTheDocument();
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
  });

  it("dates the proposal against a machine-readable timestamp", () => {
    renderCard();
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-08-18T10:00:00Z");
  });

  it("links to the merge request for anyone who does want GitLab", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /merge request/i })).toHaveAttribute(
      "href",
      "https://gl.example.com/mr/7",
    );
  });

  it("names a pull request on a GitHub deploy", () => {
    renderCard({ terms: { short: "PR", long: "pull request" } });
    expect(screen.getByRole("link", { name: /open the pull request/i })).toHaveAttribute(
      "href",
      "https://gl.example.com/mr/7",
    );
  });

  it("marks a proposal the viewer proposed themselves", () => {
    renderCard({ isSelf: true });
    expect(screen.getByText(/you proposed this/i)).toBeInTheDocument();
  });

  it("carries no self marker on somebody else's proposal", () => {
    renderCard();
    expect(screen.queryByText(/you proposed this/i)).toBeNull();
  });

  it("reports both decisions to its caller", async () => {
    const onDecide = renderCard();

    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(onDecide).toHaveBeenCalledWith("approve");

    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    expect(onDecide).toHaveBeenCalledWith("reject");
  });

  it("disables both actions while a decision is in flight", () => {
    renderCard({ busy: true });
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });

  it("reports a failure as an alert, leaving the card and its actions in place", () => {
    renderCard({ error: "You are not cleared for this item." });

    expect(screen.getByRole("alert")).toHaveTextContent("You are not cleared for this item.");
    expect(screen.getByRole("button", { name: /approve/i })).toBeEnabled();
  });
});

describe("isSelfProposal", () => {
  it("matches the viewer's address regardless of case", () => {
    expect(isSelfProposal("Alice@example.com", { email: "alice@example.com", name: "Alice Doe" })).toBe(true);
  });

  it("matches the display name a chat proposal is attributed to", () => {
    expect(isSelfProposal("Alice Doe", { email: "alice@example.com", name: "Alice Doe" })).toBe(true);
  });

  it("refuses somebody else", () => {
    expect(isSelfProposal("Bob Roe", { email: "alice@example.com", name: "Alice Doe" })).toBe(false);
  });

  it("refuses an empty proposer rather than matching an empty viewer name", () => {
    expect(isSelfProposal("", { email: "alice@example.com", name: "" })).toBe(false);
  });
});
