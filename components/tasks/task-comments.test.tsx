// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskComments } from "./task-comments";
import type { TaskComment } from "@/lib/db/task-comments";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

const people = {
  [ALICE]: { email: ALICE, name: "Alice", initials: "A", isSelf: false },
  [BOB]: { email: BOB, name: "Bob", initials: "B", isSelf: false },
};

const comments: TaskComment[] = [
  { id: "c1", taskId: "t1", authorEmail: ALICE, body: "hello there", createdAt: "2026-08-07T00:01:00.000Z", editedAt: null },
  { id: "c2", taskId: "t1", authorEmail: BOB, body: `ping @${ALICE}`, createdAt: "2026-08-07T00:02:00.000Z", editedAt: "2026-08-07T00:03:00.000Z" },
];

function renderPanel(overrides: Partial<Parameters<typeof TaskComments>[0]> = {}) {
  return render(
    <TaskComments
      taskId="t1"
      initialComments={comments}
      viewerEmail={ALICE}
      canModerate={false}
      people={people}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaskComments", () => {
  it("renders every comment with its author and an edited marker", () => {
    renderPanel();
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText(/edited/i)).toBeTruthy();
  });

  it("renders a mention as its own element rather than raw text", () => {
    renderPanel();
    expect(screen.getByText(`@${ALICE}`)).toBeTruthy();
  });

  it("shows the empty state and still offers the box", () => {
    renderPanel({ initialComments: [] });
    expect(screen.getByText(/no comments yet/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/write a comment/i)).toBeTruthy();
  });

  it("posts a comment and reloads the list", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: [...comments, { id: "c3", taskId: "t1", authorEmail: ALICE, body: "my reply", createdAt: "2026-08-07T00:04:00.000Z", editedAt: null }] }),
    } as Response);

    renderPanel();
    await userEvent.type(screen.getByPlaceholderText(/write a comment/i), "my reply");
    await userEvent.click(screen.getByRole("button", { name: /post/i }));

    await waitFor(() => expect(screen.getByText("my reply")).toBeTruthy());
    // A splice into local state would also make "my reply" appear, so pin the
    // actual contract: a POST followed by a separate list GET, not one call.
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tasks/t1/comments");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/tasks/t1/comments");
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
  });

  it("reports a refresh failure without losing the draft when the post itself succeeded", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    fetchMock.mockResolvedValueOnce({ ok: false } as Response);

    renderPanel();
    const box = screen.getByPlaceholderText(/write a comment/i);
    await userEvent.type(box, "my reply");
    await userEvent.click(screen.getByRole("button", { name: /post/i }));

    await waitFor(() => expect(screen.getByText(/could not be refreshed/i)).toBeTruthy());
    expect(box).toHaveValue("my reply");
    // The list must stay exactly as it loaded: the write succeeded, but since
    // the refresh failed there is no confirmed state to show it in.
    expect(screen.getAllByRole("listitem")).toHaveLength(comments.length);
  });

  it("keeps the draft and shows an error when the post fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    renderPanel();
    const box = screen.getByPlaceholderText(/write a comment/i);
    await userEvent.type(box, "my reply");
    await userEvent.click(screen.getByRole("button", { name: /post/i }));

    await waitFor(() => expect(screen.getByText(/could not/i)).toBeTruthy());
    expect(box).toHaveValue("my reply");
  });

  it("offers edit and delete only on your own comments", () => {
    renderPanel();
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^delete$/i })).toHaveLength(1);
  });

  it("offers delete on every comment for a moderator, but edit only on their own", () => {
    renderPanel({ canModerate: true });
    expect(screen.getAllByRole("button", { name: /^delete$/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(1);
  });
});
