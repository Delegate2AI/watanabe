import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc } from "@/lib/db/shared-docs";
import { MessageContextSchema } from "./context";

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { resolveSharedDocSelection } = await import("./context-resolve-shared-doc");

const DOC = "11111111-1111-4111-8111-111111111111";
const BODY = "# Plan\n\nThe **old figure** is wrong.\nThe plan is sound.\n";

function chip(quote: string) {
  return { type: "shared-doc-selection" as const, docId: DOC, quote, docTitle: "Plan" };
}

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: DOC, title: "Plan", ownerEmail: "alice@example.com", body: BODY });
});

describe("MessageContextSchema with the shared-doc member", () => {
  it("parses a shared-doc chip and still enforces line order on doc-selection", () => {
    expect(MessageContextSchema.safeParse(chip("x")).success).toBe(true);
    const badLines = MessageContextSchema.safeParse({
      type: "doc-selection", path: "a.md", headingTrail: [], startLine: 5, endLine: 2,
      selectedText: "x", docTitle: "A",
    });
    expect(badLines.success).toBe(false);
  });
});

describe("resolveSharedDocSelection", () => {
  it("verifies an exact source quote", () => {
    const result = resolveSharedDocSelection(chip("The plan is sound."));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.provenance).toBe("verified");
      expect(result.resolved.excerpt).toBe("The plan is sound.");
      expect(result.resolved.path).toBe(`shared-doc:${DOC}`);
    }
  });

  it("relocates a rendered-plaintext quote across markdown syntax", () => {
    // The browser selection has no ** markers; the source line does.
    const result = resolveSharedDocSelection(chip("The old figure is wrong."));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.provenance).toBe("relocated");
      expect(result.resolved.excerpt).toContain("**old figure**");
    }
  });

  it("falls back to client provenance when the quote is gone", () => {
    const result = resolveSharedDocSelection(chip("text that no longer exists"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.provenance).toBe("client");
      expect(result.resolved.excerpt).toBe("text that no longer exists");
    }
  });
});
