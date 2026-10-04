import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure branch-table unit test — every collaborator is mocked, no filesystem
// or database involved. The real end-to-end behavior of each collaborator
// (isSafeThreadId/worktreeExists, isOwnedBy) is covered by their own test
// suites (lib/repo-write.test.ts, lib/db/ownership.test.ts).

const isSafeThreadIdMock = vi.fn();
const worktreeExistsMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  isSafeThreadId: (...args: unknown[]) => isSafeThreadIdMock(...args),
  worktreeExists: (...args: unknown[]) => worktreeExistsMock(...args),
}));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const { checkDraftAccess } = await import("./draft-access");

const FAKE_DB = {} as never;

beforeEach(() => {
  isSafeThreadIdMock.mockReset();
  worktreeExistsMock.mockReset();
  isOwnedByMock.mockReset();
});

describe("checkDraftAccess", () => {
  it("returns 'invalid-or-forbidden' for an unsafe id, without checking ownership or the worktree", () => {
    isSafeThreadIdMock.mockReturnValue(false);
    expect(checkDraftAccess(FAKE_DB, "../escape", "alice@example.com")).toBe("invalid-or-forbidden");
    expect(isOwnedByMock).not.toHaveBeenCalled();
    expect(worktreeExistsMock).not.toHaveBeenCalled();
  });

  it("returns 'invalid-or-forbidden' for a safe id the requester doesn't own, without checking the worktree", () => {
    isSafeThreadIdMock.mockReturnValue(true);
    isOwnedByMock.mockReturnValue(false);
    expect(checkDraftAccess(FAKE_DB, "thread-1", "bob@example.com")).toBe("invalid-or-forbidden");
    expect(worktreeExistsMock).not.toHaveBeenCalled();
  });

  it("returns 'own-but-gone' for an owned thread whose worktree no longer exists", () => {
    isSafeThreadIdMock.mockReturnValue(true);
    isOwnedByMock.mockReturnValue(true);
    worktreeExistsMock.mockReturnValue(false);
    expect(checkDraftAccess(FAKE_DB, "thread-1", "alice@example.com")).toBe("own-but-gone");
  });

  it("returns 'own-and-live' for an owned thread with a live worktree", () => {
    isSafeThreadIdMock.mockReturnValue(true);
    isOwnedByMock.mockReturnValue(true);
    worktreeExistsMock.mockReturnValue(true);
    expect(checkDraftAccess(FAKE_DB, "thread-1", "alice@example.com")).toBe("own-and-live");
  });

  it("checks ownership and existence with the exact sessionId/requesterEmail passed in", () => {
    isSafeThreadIdMock.mockReturnValue(true);
    isOwnedByMock.mockReturnValue(true);
    worktreeExistsMock.mockReturnValue(true);
    checkDraftAccess(FAKE_DB, "thread-42", "carol@example.com");
    expect(isOwnedByMock).toHaveBeenCalledWith(FAKE_DB, "thread-42", "carol@example.com");
    expect(worktreeExistsMock).toHaveBeenCalledWith("thread-42");
  });
});
