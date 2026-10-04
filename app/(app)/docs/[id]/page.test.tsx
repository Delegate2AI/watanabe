// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
// `useRouter` is here for the annotated branch, which calls it to refresh after
// a save. Without it that branch cannot render at all.
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));

// Identity-only: the detail page must use getIdentity, NOT resolveIdentity
// (which pulls in spec-19 clearance). Mock getIdentity and spy resolveIdentity.
const getIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({ getIdentity: () => getIdentityMock() }));
const resolveIdentitySpy = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentitySpy() }));

// Spied, not replaced: the page must still resolve for real, this only records
// which addresses it asked for.
const resolvePeopleMock = vi.fn<(emails: readonly string[], options?: unknown) => Record<string, never>>();
vi.mock("@/lib/people/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/people/resolve")>();
  return {
    ...actual,
    resolvePeople: (emails: readonly string[], options?: unknown) => {
      resolvePeopleMock(emails, options);
      return actual.resolvePeople(emails, options as Parameters<typeof actual.resolvePeople>[1]);
    },
  };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const Page = (await import("./page")).default;
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare } = await import("@/lib/db/shared-docs");
const { requestAccess } = await import("@/lib/db/doc-access-requests");

const ALICE = { email: "alice@example.com" };
const BOB = { email: "bob@example.com" };
const DANA = { email: "dana@example.com" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  delete process.env.EXTERNAL_SHARE_ENABLED;
  db = openDb(":memory:");
  notFoundMock.mockClear();
  headersMock.mockReset().mockResolvedValue(new Headers());
  getIdentityMock.mockReset().mockResolvedValue(ALICE);
  insertSharedDoc(db, { id: "d1", title: "Launch plan", ownerEmail: ALICE.email, body: "# plan body" }, "2026-07-11T00:00:00.000Z");
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.EXTERNAL_SHARE_ENABLED;
});

describe("shared-doc detail page (ACL-gated)", () => {
  it("notFound() when the flag is off", async () => {
    delete process.env.SHARED_DOCS_ENABLED;
    await expect(Page(ctx("d1"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("notFound() for a stranger, identical to an unknown id (no oracle)", async () => {
    getIdentityMock.mockResolvedValue(DANA);
    await expect(Page(ctx("d1"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(Page(ctx("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the owner sees the body, comments, edit affordance, and the share affordance", async () => {
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("Launch plan");
    expect(text).toContain("Owner");
    expect(text).toContain("Comments");
    expect(text).toContain("Edit");
    // Sharing now lives behind a Share button that opens the manager in a
    // dialog, not an inline section, so the owner gets the "Share" affordance.
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Share");
  });

  it("a view-recipient sees the body but NO comments, edit, or share manager", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    getIdentityMock.mockResolvedValue(BOB);
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("Can view");
    expect(text).not.toContain("Comments");
    // No edit toggle and no share affordance for a viewer.
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).not.toContain("Edit");
    expect(buttons).not.toContain("Share");
  });

  it("a comment-recipient sees comments but NOT the edit toggle or share manager", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    getIdentityMock.mockResolvedValue(DANA);
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("Can comment");
    expect(text).toContain("Comments");
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).not.toContain("Edit");
    expect(buttons).not.toContain("Share");
    expect(buttons).toContain("Comment");
  });

  it("an edit-recipient sees the edit toggle but NOT the share manager", async () => {
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    getIdentityMock.mockResolvedValue(DANA);
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("Can edit");
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Edit");
    expect(buttons).not.toContain("Share");
  });

  // A designed page promoted here is a whole HTML document. The markdown
  // renderer drops raw HTML rather than printing it, so it must reach the
  // framed renderer on BOTH branches, not just the one the flag leaves off.
  describe("an HTML document reaches the framed renderer", () => {
    beforeEach(() => {
      insertSharedDoc(
        db,
        {
          id: "h1",
          title: "Designed page",
          ownerEmail: ALICE.email,
          body: "<h1>Designed</h1><p>Body copy.</p>",
          format: "html",
        },
        "2026-07-11T00:00:00.000Z",
      );
    });

    afterEach(() => {
      delete process.env.DOC_ANNOTATIONS_ENABLED;
    });

    it("with annotations off", async () => {
      const { container } = render(await Page(ctx("h1")));
      expect(container.querySelector("iframe")).not.toBeNull();
    });

    it("with annotations on, which is how it renders in both deployments", async () => {
      process.env.DOC_ANNOTATIONS_ENABLED = "1";
      const { container } = render(await Page(ctx("h1")));
      expect(container.querySelector("iframe")).not.toBeNull();
    });

    it("still sends a markdown document through the annotated surface", async () => {
      process.env.DOC_ANNOTATIONS_ENABLED = "1";
      const { container } = render(await Page(ctx("d1")));
      expect(container.querySelector("iframe")).toBeNull();
      // The toolbar is the annotated surface's own affordance.
      const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
      expect(buttons).toContain("Suggesting");
    });
  });

  it("resolves identity ONLY, never resolveIdentity (no KB clearance coupling, finding 5)", async () => {
    render(await Page(ctx("d1")));
    expect(getIdentityMock).toHaveBeenCalled();
    expect(resolveIdentitySpy).not.toHaveBeenCalled();
  });

  // The panels resolve an author against this map and fall back to the raw
  // address when it is missing. The viewer can ADD a row client-side, so their
  // own address has to be in the map even on a doc where they appear nowhere
  // yet, or their first comment is attributed to their email address.
  it("resolves the viewer even on a doc with nothing of theirs on it yet", async () => {
    render(await Page(ctx("d1")));
    expect(resolvePeopleMock).toHaveBeenCalled();
    // Across ALL calls, not the last one: the share picker resolves its own
    // people list too, so pinning this to a call index makes it a test of
    // evaluation order rather than of what the page put in the map.
    const emails = resolvePeopleMock.mock.calls.flatMap((call) => (call[0] as string[]) ?? []);
    expect(emails).toContain(ALICE.email);
  });
});

describe("access requests on the detail page", () => {
  beforeEach(() => {
    process.env.DOC_ACCESS_REQUESTS_ENABLED = "1";
  });
  afterEach(() => {
    delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
  });

  it("offers a stranger the request screen instead of a not-found", async () => {
    getIdentityMock.mockResolvedValue(DANA);
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("You need access");
    // Existence and nothing else: no title, no owner, no body.
    expect(text).not.toContain("Launch plan");
    expect(text).not.toContain(ALICE.email);
    expect(text).not.toContain("plan body");
  });

  it("still 404s an unknown id, which is what keeps the id unguessable", async () => {
    getIdentityMock.mockResolvedValue(DANA);
    await expect(Page(ctx("ghost"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s a stranger again with the flag off", async () => {
    delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
    getIdentityMock.mockResolvedValue(DANA);
    await expect(Page(ctx("d1"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the requester their standing ask rather than an empty form", async () => {
    requestAccess(db, { docId: "d1", requesterEmail: DANA.email, access: "edit", message: null });
    getIdentityMock.mockResolvedValue(DANA);
    const { container } = render(await Page(ctx("d1")));
    expect(container.textContent ?? "").toContain("Requested editor access");
  });

  it("puts the pending asks in front of the owner, with the requester resolved", async () => {
    requestAccess(db, { docId: "d1", requesterEmail: DANA.email, access: "comment", message: "for Tuesday" });
    const { container } = render(await Page(ctx("d1")));
    const text = container.textContent ?? "";
    expect(text).toContain("1 person is asking for access");
    expect(text).toContain("for Tuesday");
    const emails = resolvePeopleMock.mock.calls.flatMap((call) => (call[0] as string[]) ?? []);
    expect(emails).toContain(DANA.email);
  });

  it("shows a recipient nothing about who else is asking", async () => {
    requestAccess(db, { docId: "d1", requesterEmail: "eve@example.com", access: "view", message: null });
    upsertShare(db, "d1", BOB.email, "edit", "2026-07-11T00:00:01.000Z");
    getIdentityMock.mockResolvedValue(BOB);
    const { container } = render(await Page(ctx("d1")));
    expect(container.textContent ?? "").not.toContain("asking for access");
  });
});
