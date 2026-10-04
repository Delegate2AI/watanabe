// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsAdmin } from "./skills-admin";
import type { MarketplaceRow, SkillRow } from "./skills-types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const GIT_ROW: SkillRow = {
  slug: "pdf-tools",
  status: "ok",
  title: "PDF tools",
  source: { type: "git", url: "https://github.com/example/skills.git", ref: "main", commit: "abc1234" },
  groups: ["exec"],
  compat: { scripts: ["scripts/build.py", "scripts/rm-old.sh"], tools: ["Write"] },
  installed: true,
  blockedScripts: ["scripts/rm-old.sh"],
  scriptsTruncated: false,
};

const INDEX: MarketplaceRow = {
  url: "https://index.example.com/skills.json",
  items: [
    { name: "docx", description: "Word documents", url: "https://github.com/example/docx.git", ref: "v2", subdir: "skills/docx" },
    { name: "plain", description: "", url: "https://github.com/example/plain.git" },
  ],
  errors: [],
};

function renderAdmin(options: {
  entries?: SkillRow[];
  groupNames?: string[];
  marketplaceCount?: number;
} = {}) {
  return render(
    <SkillsAdmin
      entries={options.entries ?? []}
      groupNames={options.groupNames ?? ["exec", "research"]}
      marketplaceCount={options.marketplaceCount ?? 0}
    />,
  );
}

type FetchCall = [string, { method?: string; headers?: unknown; body: string }];

function calls(): FetchCall[] {
  return (fetch as unknown as { mock: { calls: FetchCall[] } }).mock.calls;
}

/** Only the mutations, so the marketplace tab's own GET cannot shift the indexes. */
function posts(): FetchCall[] {
  return calls().filter(([, init]) => init?.method === "POST");
}

/** The one body the assertions compare against, so a shape drift is a diff. */
function bodyOf(call: number = 0): unknown {
  return JSON.parse(posts()[call][1].body);
}

function installForm(): HTMLElement {
  return screen.getByRole("form", { name: "Install a skill" });
}

beforeEach(() => {
  refreshMock.mockClear();
  // A mutation POSTs; the marketplace tab GETs the list route for its indexes.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, json: async () => ({ ok: true, slug: "pdf-tools" }) }
        : { ok: true, json: async () => ({ entries: [], marketplaces: [INDEX] }) },
    ),
  );
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("SkillsAdmin install payloads", () => {
  it("posts the exact wire body for a git install", async () => {
    renderAdmin();
    const form = installForm();

    await userEvent.type(within(form).getByPlaceholderText("https://github.com/example/skills.git"), "https://github.com/example/skills.git");
    await userEvent.clear(within(form).getByPlaceholderText("main"));
    await userEvent.type(within(form).getByPlaceholderText("main"), "v1.2.0");
    await userEvent.type(within(form).getByPlaceholderText("skills/pdf"), "skills/pdf");
    await userEvent.click(within(form).getByRole("checkbox", { name: "exec" }));
    await userEvent.click(screen.getByRole("button", { name: "Install from git" }));

    expect(fetch).toHaveBeenCalledWith("/api/admin/skills", expect.objectContaining({ method: "POST" }));
    expect(bodyOf()).toEqual({
      action: "install-git",
      url: "https://github.com/example/skills.git",
      ref: "v1.2.0",
      subdir: "skills/pdf",
      groups: ["exec"],
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("omits an untouched subdir rather than sending an empty string", async () => {
    renderAdmin();
    const form = installForm();

    await userEvent.type(within(form).getByPlaceholderText("https://github.com/example/skills.git"), "https://github.com/example/skills.git");
    await userEvent.click(screen.getByRole("button", { name: "Install from git" }));

    // The route's schema is strict and its subdir is `min(1)`, so an empty
    // string is a refusal rather than "no subdir".
    expect(Object.keys(bodyOf() as object)).toEqual(["action", "url", "ref", "groups"]);
  });

  it("posts the exact wire body for a marketplace pick, index included", async () => {
    renderAdmin({ marketplaceCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    await userEvent.click(within(installForm()).getByRole("checkbox", { name: "research" }));
    await userEvent.click(screen.getByRole("button", { name: "Install docx" }));

    // The item pins a ref and a subdir and NEITHER is sent. The route re-fetches
    // the index and reads both from the entry it finds, so naming them here
    // would let a client point a named pick at a different tree, and its schema
    // is strict enough to answer 400 rather than ignore them.
    expect(bodyOf()).toEqual({
      action: "install-marketplace",
      index: "https://index.example.com/skills.json",
      name: "docx",
      url: "https://github.com/example/docx.git",
      groups: ["research"],
    });
  });

  it("sends the same five keys for an index entry that pins nothing", async () => {
    renderAdmin({ marketplaceCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    await userEvent.click(screen.getByRole("button", { name: "Install plain" }));

    expect(Object.keys(bodyOf() as object)).toEqual(["action", "index", "name", "url", "groups"]);
  });

  it("uploads a zip as multipart with the groups as a JSON array", async () => {
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Zip upload" }));
    const form = installForm();

    const file = new File(["PK"], "pdf-tools.zip", { type: "application/zip" });
    await userEvent.upload(within(form).getByLabelText("Skill archive"), file);
    await userEvent.click(within(form).getByRole("checkbox", { name: "exec" }));
    await userEvent.click(screen.getByRole("button", { name: "Install from zip" }));

    const [url, init] = posts()[0] as unknown as [string, { method: string; headers?: unknown; body: FormData }];
    expect(url).toBe("/api/admin/skills/upload");
    expect(init.method).toBe("POST");
    // No content-type, so the browser writes the multipart boundary itself.
    // Setting one here breaks every upload at runtime and nothing else notices.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("groups")).toBe('["exec"]');
    expect((init.body.get("file") as File).name).toBe("pdf-tools.zip");
  });

  it("tells the admin a marketplace tab has nothing behind it rather than showing an empty list", async () => {
    // Only reachable when the built-in index has been turned off, since it is
    // offered by default: see lib/skills/marketplace-builtin.ts.
    renderAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));

    expect(screen.getByText(/No marketplace index is available/i)).toBeInTheDocument();
    // Nothing configured means nothing to fetch, so the tab costs no request.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("SkillsAdmin marketplace fan-out", () => {
  it("loads no index until the tab is opened, so a plain page visit costs no request", () => {
    renderAdmin({ marketplaceCount: 1 });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the indexes once, and not again for a second install or a return to the tab", async () => {
    renderAdmin({ marketplaceCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    expect(calls().filter(([, init]) => init?.method !== "POST")).toHaveLength(1);

    // Two installs and a round trip through another tab. The indexes live in the
    // form's state, which a router.refresh() does not remount, so the network
    // fan-out behind them must not run again.
    await userEvent.click(screen.getByRole("button", { name: "Install docx" }));
    await userEvent.click(screen.getByRole("button", { name: "Install plain" }));
    await userEvent.click(screen.getByRole("button", { name: "Git" }));
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));

    expect(calls().filter(([, init]) => init?.method !== "POST")).toHaveLength(1);
    expect(posts()).toHaveLength(2);
  });

  it("re-pulls the indexes only when the admin asks for it", async () => {
    renderAdmin({ marketplaceCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));
    await userEvent.click(screen.getByRole("button", { name: "Reload indexes" }));

    expect(calls().filter(([, init]) => init?.method !== "POST")).toHaveLength(2);
  });

  it("offers a retry rather than an empty tab when the indexes cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code: "internal" } }) }));
    renderAdmin({ marketplaceCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("SkillsAdmin per-skill actions", () => {
  it("posts the update verb for one slug", async () => {
    renderAdmin({ entries: [GIT_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Update pdf-tools" }));

    expect(bodyOf()).toEqual({ action: "update", slug: "pdf-tools" });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("posts the set-groups verb with the checked groups", async () => {
    renderAdmin({ entries: [GIT_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Edit groups of pdf-tools" }));
    const editor = screen.getByRole("form", { name: "Clearance groups for pdf-tools" });

    await userEvent.click(within(editor).getByRole("checkbox", { name: "research" }));
    await userEvent.click(within(editor).getByRole("button", { name: "Save groups" }));

    expect(bodyOf()).toEqual({ action: "set-groups", slug: "pdf-tools", groups: ["exec", "research"] });
  });

  it("posts the uninstall verb once the deletion is confirmed", async () => {
    renderAdmin({ entries: [GIT_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Uninstall pdf-tools" }));

    expect(bodyOf()).toEqual({ action: "uninstall", slug: "pdf-tools" });
  });

  it("posts nothing when the uninstall confirmation is declined", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderAdmin({ entries: [GIT_ROW] });
    await userEvent.click(screen.getByRole("button", { name: "Uninstall pdf-tools" }));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers no update for a zip-installed skill, which has no remote to re-fetch", () => {
    renderAdmin({ entries: [{ ...GIT_ROW, source: { type: "zip", filename: "pdf-tools.zip" } }] });

    expect(screen.queryByRole("button", { name: "Update pdf-tools" })).toBeNull();
  });
});

// Reporting (blocked scripts, a replaced install, a surviving store directory,
// a refusal's reason) is asserted in ./skills-admin.outcome.test.tsx.
describe("SkillsAdmin stale groups", () => {
  const STALE_ROW: SkillRow = { ...GIT_ROW, groups: ["legacy", "exec"] };

  it("drops a group that no longer exists, so the payload matches the checkboxes", async () => {
    renderAdmin({ entries: [STALE_ROW], groupNames: ["exec", "research"] });
    await userEvent.click(screen.getByRole("button", { name: "Edit groups of pdf-tools" }));
    const editor = screen.getByRole("form", { name: "Clearance groups for pdf-tools" });

    expect(within(editor).queryByRole("checkbox", { name: "legacy" })).toBeNull();
    expect(within(editor).getByRole("checkbox", { name: "exec" })).toBeChecked();
    await userEvent.click(within(editor).getByRole("button", { name: "Save groups" }));

    expect(bodyOf()).toEqual({ action: "set-groups", slug: "pdf-tools", groups: ["exec"] });
  });

  it("names the dropped group rather than removing it silently", async () => {
    renderAdmin({ entries: [STALE_ROW], groupNames: ["exec", "research"] });
    await userEvent.click(screen.getByRole("button", { name: "Edit groups of pdf-tools" }));

    expect(screen.getByTestId("stale-groups")).toHaveTextContent("legacy");
  });
});
