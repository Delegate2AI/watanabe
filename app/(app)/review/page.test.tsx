// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitPullRequest } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { messageFor } from "@/lib/errors/messages";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const isKbReviewEnabledMock = vi.fn();
vi.mock("@/lib/review/config", () => ({ isKbReviewEnabled: () => isKbReviewEnabledMock() }));
const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...a: unknown[]) => canMock(...a) }));
const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentityMock() }));
const viewerNameMock = vi.fn();
vi.mock("@/lib/people/resolve", () => ({ viewerName: (...a: unknown[]) => viewerNameMock(...a) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const loadProposalsMock = vi.fn();
vi.mock("@/lib/review/queue", () => ({ loadProposals: (...a: unknown[]) => loadProposalsMock(...a) }));

const Page = (await import("./page")).default;

const PROPOSAL = {
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
  origin: "chat" as const,
};

beforeEach(() => {
  notFoundMock.mockClear();
  isKbReviewEnabledMock.mockReset().mockReturnValue(true);
  canMock.mockReset().mockReturnValue(true);
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "boss@example.com", clearance: ["exec"] });
  viewerNameMock.mockReset().mockReturnValue({ name: "Boss Person", initials: "B" });
  loadProposalsMock.mockReset().mockResolvedValue([PROPOSAL]);
});

describe("ReviewPage", () => {
  it("renders the dormant scaffold with the flag off, reading neither identity nor GitLab", async () => {
    isKbReviewEnabledMock.mockReturnValue(false);

    const actual = renderToStaticMarkup(await Page());
    const expected = renderToStaticMarkup(
      <RouteScaffold
        icon={GitPullRequest}
        eyebrow="Review"
        title="Changes waiting on you"
        description="Knowledge-base changes people have proposed. Read the change, then merge it into the knowledge base or send it back."
        spec="the 2026-08-18 review design"
        flag="KB_REVIEW_ENABLED"
      />,
    );

    expect(actual).toBe(expected);
    expect(resolveIdentityMock).not.toHaveBeenCalled();
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("404s for a viewer without the approve capability, reading no proposals", async () => {
    canMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(canMock).toHaveBeenCalledWith("boss@example.com", "approve");
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("404s identically when there is no identity at all", async () => {
    resolveIdentityMock.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("renders the queue for an approver", async () => {
    const { container } = render(await Page());

    expect(container.textContent).toContain("Add the desk handbook");
    expect(container.textContent).toContain("docs/desk/handbook.md");
    expect(container.textContent).not.toContain("not switched on here");
    expect(loadProposalsMock).toHaveBeenCalledWith(expect.anything(), "boss@example.com");
  });

  it("links each proposal as a pull request on a GitHub deploy", async () => {
    const saved = { REPO_URL: process.env.REPO_URL, GIT_HOST: process.env.GIT_HOST };
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    delete process.env.GIT_HOST;
    try {
      const { container } = render(await Page());
      expect(container.textContent).toContain("Open the pull request");
      expect(container.textContent).not.toContain("merge request");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("renders the error state when the queue could not be read from GitLab", async () => {
    loadProposalsMock.mockRejectedValue(new Error("unreachable"));

    const { container } = render(await Page());

    expect(container.textContent).toContain(messageFor("review_unavailable"));
    expect(container.textContent).not.toContain("Nothing is waiting");
  });
});
