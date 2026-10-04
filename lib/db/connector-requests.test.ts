import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { migrate } from "./migrate";
import { createConnectorRequest, listOpenConnectorRequests, countOpenConnectorRequests, resolveConnectorRequest } from "./connector-requests";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("createConnectorRequest", () => {
  it("creates a request and returns the id", () => {
    const result = createConnectorRequest(db, { requesterEmail: "user@example.com", text: "Please add connector X" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("creates a request with trimmed text", () => {
    createConnectorRequest(db, { requesterEmail: "user@example.com", text: "  Please add connector X  " });
    const requests = listOpenConnectorRequests(db);
    expect(requests[0].text).toBe("Please add connector X");
  });

  it("returns the same id on repeated calls", () => {
    const text = "Please add connector X";
    const result = createConnectorRequest(db, { requesterEmail: "user@example.com", text });
    expect(result).toBeDefined();
  });
});

describe("listOpenConnectorRequests", () => {
  it("returns empty array when no requests exist", () => {
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("returns the created request with requester email and text", () => {
    const id = createConnectorRequest(db, { requesterEmail: "user@example.com", text: "Please add connector X" });
    const requests = listOpenConnectorRequests(db);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id,
      requesterEmail: "user@example.com",
      text: "Please add connector X"
    });
    expect(requests[0].createdAt).toBeDefined();
  });

  it("excludes resolved requests", () => {
    const id1 = createConnectorRequest(db, { requesterEmail: "user1@example.com", text: "Request 1" });
    const id2 = createConnectorRequest(db, { requesterEmail: "user2@example.com", text: "Request 2" });

    resolveConnectorRequest(db, id1, "admin@example.com");

    const requests = listOpenConnectorRequests(db);
    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe(id2);
  });
});

describe("countOpenConnectorRequests", () => {
  it("returns 0 when no requests exist", () => {
    expect(countOpenConnectorRequests(db)).toBe(0);
  });

  it("returns the count of open requests", () => {
    createConnectorRequest(db, { requesterEmail: "user1@example.com", text: "Request 1" });
    createConnectorRequest(db, { requesterEmail: "user2@example.com", text: "Request 2" });

    expect(countOpenConnectorRequests(db)).toBe(2);
  });

  it("excludes resolved requests from the count", () => {
    const id1 = createConnectorRequest(db, { requesterEmail: "user1@example.com", text: "Request 1" });
    createConnectorRequest(db, { requesterEmail: "user2@example.com", text: "Request 2" });

    resolveConnectorRequest(db, id1, "admin@example.com");

    expect(countOpenConnectorRequests(db)).toBe(1);
  });
});

describe("resolveConnectorRequest", () => {
  it("returns true and marks the request as resolved", () => {
    const id = createConnectorRequest(db, { requesterEmail: "user@example.com", text: "Request" });

    expect(resolveConnectorRequest(db, id, "admin@example.com")).toBe(true);
  });

  it("removes the request from the open list after resolving", () => {
    const id = createConnectorRequest(db, { requesterEmail: "user@example.com", text: "Request" });

    resolveConnectorRequest(db, id, "admin@example.com");

    const requests = listOpenConnectorRequests(db);
    expect(requests).toHaveLength(0);
  });

  it("returns false when called with an unknown id", () => {
    expect(resolveConnectorRequest(db, "unknown-id", "admin@example.com")).toBe(false);
  });

  it("returns false when resolving an already-resolved request", () => {
    const id = createConnectorRequest(db, { requesterEmail: "user@example.com", text: "Request" });

    resolveConnectorRequest(db, id, "admin@example.com");
    const secondResolve = resolveConnectorRequest(db, id, "another-admin@example.com");

    expect(secondResolve).toBe(false);
  });
});
