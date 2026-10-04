// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsAdmin } from "./skills-admin";
import type { SkillRow } from "./skills-types";

/**
 * What the surface REPORTS, as opposed to what it posts (see
 * ./skills-admin.test.tsx). Split from that file so neither runs into the
 * 300-line cap, on the same naming shape as lib/skills/store.update-title.test.ts.
 *
 * Three of these are successes at the HTTP level that an admin still has to
 * see: an install that overwrote an existing skill, an uninstall that could not
 * delete the files, and a skill whose scripts the bash policy can never run.
 */

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

function renderAdmin(entries: SkillRow[] = []) {
  return render(<SkillsAdmin entries={entries} groupNames={["exec", "research"]} marketplaceCount={0} />);
}

function replyWith(body: unknown, ok: boolean = true): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

/** Fill the git tab and submit, which is the shortest path to a reported install. */
async function installSomething(): Promise<void> {
  const form = screen.getByRole("form", { name: "Install a skill" });
  await userEvent.type(
    within(form).getByPlaceholderText("https://github.com/example/skills.git"),
    "https://github.com/example/skills.git",
  );
  await userEvent.click(screen.getByRole("button", { name: "Install from git" }));
}

beforeEach(() => {
  refreshMock.mockClear();
  vi.stubGlobal("confirm", vi.fn(() => true));
  replyWith({ ok: true, slug: "pdf-tools" });
});

describe("SkillsAdmin outcome reporting", () => {
  it("names every script that can never run when an install reports one", async () => {
    replyWith({ ok: true, slug: "pdf-tools", blockedScripts: ["scripts/rm-old.sh"] });
    renderAdmin();
    await installSomething();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("scripts/rm-old.sh");
    expect(alert).toHaveTextContent(/can never run/i);
    expect(alert).toHaveTextContent(/rename/i);
  });

  it("says outright that an install overwrote an already-installed skill", async () => {
    replyWith({ ok: true, slug: "pdf-tools", replaced: true, commit: "def5678" });
    renderAdmin();
    await installSomething();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/replaced/i);
    expect(alert).toHaveTextContent("pdf-tools");
  });

  it("reports a store directory that survived an uninstall instead of claiming a clean removal", async () => {
    replyWith({ ok: true, slug: "pdf-tools", warning: "store_directory_remains" });
    renderAdmin([GIT_ROW]);
    await userEvent.click(screen.getByRole("button", { name: "Uninstall pdf-tools" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be deleted/i);
    expect(alert).toHaveTextContent(/by hand/i);
  });

  it("shows the old and the new commit after an update", async () => {
    replyWith({ ok: true, slug: "pdf-tools", commit: "def5678", previousCommit: "abc1234" });
    renderAdmin([GIT_ROW]);
    await userEvent.click(screen.getByRole("button", { name: "Update pdf-tools" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("abc1234");
    expect(status).toHaveTextContent("def5678");
  });

  it("shows the pipeline's own reason when an install is refused", async () => {
    replyWith({ error: { code: "invalid_request", detail: "install" }, reason: "SKILL.md is missing" }, false);
    renderAdmin();
    await installSomething();

    expect(await screen.findByText(/SKILL.md is missing/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("SkillsAdmin list", () => {
  it("renders the compat badges and the blocked scripts a row already carries", () => {
    renderAdmin([GIT_ROW]);

    expect(screen.getByText("scripts: 2")).toBeInTheDocument();
    expect(screen.getByText("unsupported tools: 1")).toBeInTheDocument();
    expect(screen.getByTestId("blocked-scripts-pdf-tools")).toHaveTextContent("scripts/rm-old.sh");
  });

  it("marks a registry entry whose store folder is gone rather than showing it as healthy", () => {
    renderAdmin([{ ...GIT_ROW, installed: false }]);

    expect(screen.getByText("files missing")).toBeInTheDocument();
    expect(screen.getByText(/Update it to fetch the content again/i)).toBeInTheDocument();
  });

  it("points a missing zip install at a re-upload, not at the Update button it does not have", () => {
    renderAdmin([{ ...GIT_ROW, installed: false, source: { type: "zip", filename: "pdf-tools.zip" } }]);

    expect(screen.queryByRole("button", { name: "Update pdf-tools" })).toBeNull();
    expect(screen.getByText(/upload the archive again/i)).toBeInTheDocument();
    expect(screen.queryByText(/Update it to fetch the content again/i)).toBeNull();
  });

  it("says the blocked-script check read a shortened list when the recorded one was capped", () => {
    renderAdmin([{ ...GIT_ROW, scriptsTruncated: true }]);

    expect(screen.getByTestId("scripts-truncated-pdf-tools")).toHaveTextContent(/shortened/i);
  });

  it("says nothing about truncation for a skill whose recorded list is whole", () => {
    renderAdmin([GIT_ROW]);

    expect(screen.queryByTestId("scripts-truncated-pdf-tools")).toBeNull();
  });

  it("says so when nothing is installed yet", () => {
    renderAdmin();

    expect(screen.getByText(/No skills are installed yet/i)).toBeInTheDocument();
  });
});
