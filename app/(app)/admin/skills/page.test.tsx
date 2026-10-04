// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
const resolveIdentityMock = vi.fn();
const canMock = vi.fn();
const skillsEnabledMock = vi.fn();
const loadRegistryMock = vi.fn();
const storeDirExistsMock = vi.fn();
const loadAccessMock = vi.fn();
const configuredMarketplacesMock = vi.fn();

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args) }));
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));
vi.mock("@/lib/authority/access", () => ({ loadAccess: () => loadAccessMock() }));
vi.mock("@/lib/skills/config", () => ({ isSkillsEnabled: () => skillsEnabledMock() }));
vi.mock("@/lib/skills/registry", () => ({ loadSkillRegistry: () => loadRegistryMock() }));
vi.mock("@/lib/skills/admin-record", () => ({
  storeDirExists: (...args: unknown[]) => storeDirExistsMock(...args),
  // The real scrub, so a page-only regression that stops scrubbing is visible.
  scrubReason: (reason: string) => reason.replace(/\s+/g, " ").trim().slice(0, 300),
}));
vi.mock("@/lib/skills/marketplace", () => ({ configuredMarketplaces: () => configuredMarketplacesMock() }));

import Page from "./page";

const INSTALLED = {
  slug: "pdf-tools",
  title: "PDF tools",
  source: { type: "git" as const, url: "https://github.com/example/skills.git", ref: "main", commit: "abc1234" },
  groups: ["exec"],
  // `rm-old.sh` trips the Tier 0 destructive pattern on its path alone, so the
  // carve-out can never run it. `build.py` trips nothing.
  compat: { scripts: ["scripts/build.py", "scripts/rm-old.sh"], tools: ["Write"] },
};

beforeEach(() => {
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "admin@example.com" });
  canMock.mockReset().mockReturnValue(true);
  skillsEnabledMock.mockReset().mockReturnValue(true);
  loadRegistryMock.mockReset().mockReturnValue({ entries: [INSTALLED], errors: [] });
  storeDirExistsMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { exec: ["admin@example.com"] } });
  configuredMarketplacesMock.mockReset().mockReturnValue([]);
  notFoundMock.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

describe("SkillsAdminPage", () => {
  it("renders an installed skill with its source pin and its compat badges", async () => {
    const { container } = render(await Page());

    expect(container.textContent).toContain("Skills");
    expect(container.textContent).toContain("pdf-tools");
    expect(container.textContent).toContain("abc1234");
    expect(container.textContent).toContain("scripts: 2");
    expect(container.textContent).toContain("unsupported tools: 1");
  });

  it("names the scripts the bash policy can never run, and why", async () => {
    const { container } = render(await Page());

    expect(container.textContent).toContain("scripts/rm-old.sh");
    expect(container.textContent).toContain("can never run");
    // A script whose path trips nothing is not accused of being blocked.
    expect(container.textContent).not.toContain("scripts/build.py can never");
  });

  it("shows a registry entry whose store directory has gone missing as broken", async () => {
    storeDirExistsMock.mockReturnValue(false);
    const { container } = render(await Page());

    expect(container.textContent).toContain("files missing");
  });

  it("shows a rejected registry entry with the loader's reason", async () => {
    loadRegistryMock.mockReturnValue({ entries: [], errors: [{ slug: "broken", reason: "invalid skill entry" }] });
    const { container } = render(await Page());

    expect(container.textContent).toContain("broken");
    expect(container.textContent).toContain("invalid skill entry");
  });

  it("passes the configured index count down, and the tab loads the indexes itself", async () => {
    configuredMarketplacesMock.mockReturnValue(["https://index.example.com/skills.json"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [],
        marketplaces: [{
          url: "https://index.example.com/skills.json",
          items: [{ name: "docx", description: "Word documents", url: "https://github.com/example/docx.git" }],
          errors: [],
        }],
      }),
    }));
    const { container } = render(await Page());
    // Rendering the page must cost no marketplace request: that fan-out used to
    // run again on every router.refresh() after every mutation.
    expect(fetch).not.toHaveBeenCalled();

    // Clicking through proves the whole chain: the page passed a real count, the
    // tab loaded the indexes, and the picker received them.
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));

    expect(fetch).toHaveBeenCalledWith("/api/admin/skills");
    expect(container.textContent).toContain("docx");
    expect(container.textContent).toContain("Word documents");
  });

  it("reports a marketplace index that could not be read instead of hiding it", async () => {
    configuredMarketplacesMock.mockReturnValue(["https://index.example.com/skills.json"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [],
        marketplaces: [{ url: "https://index.example.com/skills.json", error: "marketplace index is not JSON" }],
      }),
    }));
    const { container } = render(await Page());
    await userEvent.click(screen.getByRole("button", { name: "Marketplace" }));

    expect(container.textContent).toContain("marketplace index is not JSON");
  });

  it("says the blocked-script check is partial when the recorded list hit its cap", async () => {
    loadRegistryMock.mockReturnValue({
      entries: [{ ...INSTALLED, compat: { scripts: ["scripts/build.py", "+7 more"], tools: [] } }],
      errors: [],
    });
    const { getByTestId, container } = render(await Page());

    expect(getByTestId("scripts-truncated-pdf-tools")).toBeInTheDocument();
    // The cap marker is a count, not a script, so it is never itself derived from.
    expect(container.textContent).not.toContain("+7 more can never");
  });

  it("says the same when one recorded path was clipped past its character cap", async () => {
    loadRegistryMock.mockReturnValue({
      entries: [{ ...INSTALLED, compat: { scripts: [`scripts/${"a".repeat(200)}... (truncated)`], tools: [] } }],
      errors: [],
    });
    const { getByTestId } = render(await Page());

    expect(getByTestId("scripts-truncated-pdf-tools")).toBeInTheDocument();
  });

  it("returns the identical 404 for a non-admin or a missing identity", async () => {
    canMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    resolveIdentityMock.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadRegistryMock).not.toHaveBeenCalled();
    expect(configuredMarketplacesMock).not.toHaveBeenCalled();
  });

  it("returns 404 with SKILLS_ENABLED off, so flag-off shows no admin surface", async () => {
    skillsEnabledMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadRegistryMock).not.toHaveBeenCalled();
    expect(configuredMarketplacesMock).not.toHaveBeenCalled();
  });
});
