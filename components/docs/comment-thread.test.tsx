// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThreadCard } from "./comment-thread";
import type { CommentThread } from "@/lib/shared-docs/types";

afterEach(cleanup);

const thread: CommentThread = {
  id: "t1", docId: "d1", anchor: null, status: "open",
  createdBy: "alice@example.com", createdAt: "2026-07-11T00:01:00.000Z",
  resolvedBy: null, resolvedAt: null,
  messages: [{ id: "m1", authorEmail: "alice@example.com", body: "hi @bob@example.com", createdAt: "2026-07-11T00:01:00.000Z" }],
};

describe("CommentThreadCard", () => {
  it("renders messages and a resolve control when canComment", () => {
    render(<CommentThreadCard thread={thread} canComment onReply={vi.fn()} onResolve={vi.fn()} />);
    expect(screen.getByText(/hi/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /resolve/i })).toBeTruthy();
  });

  it("hides the reply box when not canComment", () => {
    render(<CommentThreadCard thread={thread} canComment={false} onReply={vi.fn()} onResolve={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/reply/i)).toBeNull();
  });

  it("keeps the draft and shows an error when the reply fails", async () => {
    const onReply = vi.fn().mockRejectedValue(new Error("failed to post reply"));
    render(<CommentThreadCard thread={thread} canComment onReply={onReply} onResolve={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/reply/i);
    await userEvent.type(textarea, "my reply");
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(textarea).toHaveValue("my reply");
    expect(screen.getByText(/could not post/i)).toBeTruthy();
  });
});
