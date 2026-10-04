import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_MARKETPLACE_ID } from "@/lib/skills/marketplace";
import type { SkillActionBody } from "./skills-types";
import {
  gitInstallBody,
  marketplaceInstallBody,
  setGroupsBody,
  uninstallBody,
  updateBody,
} from "./skills-payloads";

/**
 * The seam between what this admin surface POSTS and what the route ACCEPTS.
 *
 * Every other test on either side of that seam is blind to it. The client tests
 * assert bodies against a mocked fetch, and the route tests assert the route
 * refuses keys it does not know. Both pass while the two disagree, which is
 * exactly how a schema change on the route silently 400d every marketplace
 * install of an entry that pinned a ref or a subdir.
 *
 * So this walks the REAL route handler with the REAL bodies the client builds.
 * `actionSchema` is a `.strict()` discriminated union, so an extra key is a
 * refusal rather than an ignored field; the assertion is that the route got as
 * far as dispatching the action, which it only does after that schema passes.
 *
 * Add a case here for every new action. The negative control below proves the
 * test can still tell acceptance from rejection.
 */

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const isSkillsEnabledMock = vi.fn();
vi.mock("@/lib/skills/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/config")>();
  return { ...actual, isSkillsEnabled: () => isSkillsEnabledMock() };
});

// The only thing stubbed beyond the gate. Every arm of it would otherwise clone,
// unpack, or commit; what is under test is whether the route accepts the body at
// all, which is decided before this is ever reached.
const runSkillAdminActionMock = vi.fn();
vi.mock("@/lib/skills/admin-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/admin-actions")>();
  return { ...actual, runSkillAdminAction: (...args: unknown[]) => runSkillAdminActionMock(...args) };
});

import { POST } from "@/app/api/admin/skills/route";

const INDEX_URL = "https://index.example.com/skills.json";

/** The shape an index entry has when it pins everything it may pin. */
const PINNED_ITEM = {
  name: "docx",
  description: "Word documents",
  url: "https://github.com/example/docx.git",
  ref: "v2",
  subdir: "skills/docx",
};

const BARE_ITEM = {
  name: "plain",
  description: "",
  url: "https://github.com/example/plain.git",
};

const CASES: Array<{ what: string; body: SkillActionBody }> = [
  {
    what: "a marketplace pick whose index entry pins a ref and a subdir",
    body: marketplaceInstallBody(INDEX_URL, PINNED_ITEM, ["exec"]),
  },
  {
    what: "a marketplace pick whose index entry pins neither",
    body: marketplaceInstallBody(INDEX_URL, BARE_ITEM, []),
  },
  {
    // The built-in index's id is a sentinel, not a URL, and it travels in the
    // same `index` field a configured index's URL travels in. The route's
    // bound on that field is length only, so this passes, but nothing else
    // says so: a stricter bound added later would kill every built-in install
    // and no other test on either side of this seam would notice.
    what: "a marketplace pick from the built-in index, whose id is not a URL",
    body: marketplaceInstallBody(BUILTIN_MARKETPLACE_ID, BARE_ITEM, ["exec"]),
  },
  {
    what: "a git install with a subdirectory",
    body: gitInstallBody({
      url: "https://github.com/example/skills.git",
      ref: "v1.2.0",
      subdir: "skills/pdf",
      groups: ["exec"],
    }),
  },
  {
    what: "a git install with no subdirectory",
    body: gitInstallBody({ url: "https://github.com/example/skills.git", ref: "main", groups: [] }),
  },
  { what: "an update", body: updateBody("pdf-tools") },
  { what: "an uninstall", body: uninstallBody("pdf-tools") },
  { what: "a clearance change", body: setGroupsBody("pdf-tools", ["exec", "research"]) },
];

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://portal.example.com/api/admin/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  runSkillAdminActionMock.mockReset().mockResolvedValue({ ok: true, slug: "pdf-tools" });
});

describe("the admin skills surface against the route it posts to", () => {
  it.each(CASES)("the route accepts the body the client builds for $what", async ({ body }) => {
    const response = await post(body);

    expect(await response.json()).not.toMatchObject({ error: { detail: "body" } });
    expect(response.status).toBe(200);
    // Dispatch only happens once the strict schema has passed, so this is the
    // proof that every key the client sent is one the route still knows.
    expect(runSkillAdminActionMock).toHaveBeenCalledWith(body, "admin@example.com");
  });

  // Negative control. Without it, a test that stopped exercising the schema at
  // all would still report seven passes.
  it("rejects a body carrying a key the route no longer takes", async () => {
    const response = await post({ ...marketplaceInstallBody(INDEX_URL, BARE_ITEM, []), ref: "v2" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { detail: "body" } });
    expect(runSkillAdminActionMock).not.toHaveBeenCalled();
  });
});
