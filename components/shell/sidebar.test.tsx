// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/components/theme-provider";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));

import { Sidebar } from "./sidebar";

// The sidebar's thread groups are now live (spec 24): ThreadLists fetches
// GET /api/threads. Stub it so the groups render deterministically.
beforeEach(() => {
  // Section open/closed state is remembered in localStorage, and jsdom shares
  // one window across the file, so without this a section left closed by one
  // test starts closed in the next.
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          threads: [
            { id: "s1", title: "Summarize Q3 exec sync", updatedAt: "2026-07-08T00:00:00Z", pinned: false },
            { id: "s2", title: "Points doctrine", updatedAt: "2026-07-07T00:00:00Z", pinned: true },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch,
  );
});
afterEach(() => vi.restoreAllMocks());

function renderSidebar(props: ComponentProps<typeof Sidebar> = {}) {
  return render(
    <ThemeProvider>
      <Sidebar {...props} />
    </ThemeProvider>,
  );
}

/** The visible nav labels of the desktop aside, in render order. */
function primaryNavLabels(): (string | undefined)[] {
  const nav = document.querySelector("aside nav");
  return Array.from(nav?.querySelectorAll("a") ?? []).map((link) => link.textContent?.trim());
}

/** Expand a collapsed section in the desktop aside. */
async function openSection(name: RegExp): Promise<void> {
  const user = userEvent.setup();
  const nav = document.querySelector("aside nav");
  const header = within(nav as HTMLElement).getByRole("button", { name });
  if (header.getAttribute("aria-expanded") === "false") await user.click(header);
}

describe("Sidebar", () => {
  it("renders the primary nav and the live Tasks count when provided", () => {
    renderSidebar({ tasksCount: 4 });
    for (const label of [
      "Home",
      "Knowledge base",
      "Tasks",
      "Meetings",
      "Projects",
      "Artifacts",
      "My Shared Docs",
    ]) {
      expect(
        screen.getByRole("link", { name: new RegExp(label, "i") }),
      ).toBeInTheDocument();
    }
    // The count is threaded from the server layout, not a static stub, so it
    // renders in both the desktop aside and the mobile sheet.
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("renders no Tasks badge when the count is undefined (flag off / none pending)", () => {
    renderSidebar();
    // The old static "4" is gone; with no count there is no badge digit.
    expect(screen.queryByText("4")).toBeNull();
  });

  it("hides the Access admin entry by default (no manageAccess capability)", () => {
    renderSidebar();
    expect(screen.queryByRole("link", { name: /access admin/i })).toBeNull();
  });

  it("shows the Access admin entry when the layout resolves showAdmin", async () => {
    renderSidebar({ showAdmin: true });
    await openSection(/^administration/i);
    const links = screen.getAllByRole("link", { name: /access admin/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/admin/access");
  });

  it("hides the connector registry for an admin while CONNECTORS_ENABLED is off", async () => {
    renderSidebar({ showAdmin: true });
    await openSection(/^administration/i);
    expect(screen.queryByRole("link", { name: /connector registry/i })).toBeNull();
  });

  it("shows the connector registry when the layout resolves showConnectors", async () => {
    renderSidebar({ showAdmin: true, showConnectors: true });
    await openSection(/^administration/i);
    expect(screen.getAllByRole("link", { name: /connector registry/i })[0]).toHaveAttribute(
      "href",
      "/admin/connectors",
    );
  });

  it("shows the connectors directory on the flag alone, with no admin capability", async () => {
    renderSidebar({ showConnectorsDirectory: true });
    await openSection(/^integrations/i);
    expect(screen.getAllByRole("link", { name: /^connectors$/i })[0]).toHaveAttribute("href", "/connectors");
  });

  it("hides the connectors directory when showConnectorsDirectory is false, even for an admin", async () => {
    // Skill studio on, so Integrations exists and is genuinely open: the
    // directory's absence is then an absence, not a collapsed section.
    renderSidebar({ showAdmin: true, showConnectors: true, showSkills: true, showSkillStudio: true });
    await openSection(/^integrations/i);
    expect(screen.getAllByRole("link", { name: /skill studio/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /^connectors$/i })).toBeNull();
  });

  it("puts the connectors directory in Integrations, not with the admin entries", async () => {
    renderSidebar({ showAdmin: true, showConnectors: true, showSkills: true, showConnectorsDirectory: true, showSkillStudio: true });
    await openSection(/^integrations/i);
    const nav = document.querySelector("aside nav") as HTMLElement;
    const integrations = within(nav).getByRole("button", { name: /^integrations/i });
    const group = integrations.parentElement as HTMLElement;
    expect(within(group).getByRole("link", { name: /^connectors$/i })).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: /skill studio/i })).toBeInTheDocument();
  });

  it("hides the skill registry for an admin while SKILLS_ENABLED is off", async () => {
    renderSidebar({ showAdmin: true, showConnectors: true });
    await openSection(/^administration/i);
    expect(screen.queryByRole("link", { name: /skill registry/i })).toBeNull();
  });

  it("shows the skill registry when the layout resolves showSkills", async () => {
    renderSidebar({ showAdmin: true, showConnectors: true, showSkills: true });
    await openSection(/^administration/i);
    expect(screen.getAllByRole("link", { name: /skill registry/i })[0]).toHaveAttribute("href", "/admin/skills");
  });

  it("hides the usage entry for an admin while USAGE_AUDIT_ENABLED is off", async () => {
    renderSidebar({ showAdmin: true });
    await openSection(/^administration/i);
    expect(screen.queryByRole("link", { name: /usage and cost/i })).toBeNull();
  });

  it("shows the usage entry when the layout resolves showUsage", async () => {
    renderSidebar({ showAdmin: true, showUsage: true });
    await openSection(/^administration/i);
    expect(screen.getAllByRole("link", { name: /usage and cost/i })[0]).toHaveAttribute("href", "/admin/usage");
  });

  it("hides the Skill studio entry by default (no grant, no admin)", async () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: /^integrations/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /skill studio/i })).toBeNull();
  });

  it("shows the Skill studio entry on the flag and grant alone, with no admin capability", async () => {
    renderSidebar({ showSkillStudio: true });
    await openSection(/^integrations/i);
    expect(screen.getAllByRole("link", { name: /skill studio/i })[0]).toHaveAttribute("href", "/skills");
  });

  it("hides the People entry while PEOPLE_ACTIVITY_ENABLED is off", () => {
    // Not an admin entry: even an admin sees no link until the flag is on. Work
    // is open by default, so its absence here is a real absence.
    renderSidebar({ showAdmin: true, showConnectors: true, showSkills: true });
    expect(screen.queryByRole("link", { name: /^people$/i })).toBeNull();
  });

  it("shows People inside Work on the flag alone, with no admin capability", () => {
    renderSidebar({ showPeople: true });
    const nav = document.querySelector("aside nav") as HTMLElement;
    const work = within(nav).getByRole("button", { name: /^work/i });
    const group = work.parentElement as HTMLElement;
    expect(within(group).getByRole("link", { name: /^people$/i })).toHaveAttribute("href", "/people");
  });

  it("renders Knowledge and Work in order with their default membership", () => {
    // The two sections that open by default, for a viewer with no capability
    // and no flags. This is the shape almost everybody sees.
    renderSidebar();
    expect(primaryNavLabels()).toEqual([
      "Home",
      "Knowledge base",
      "Artifacts",
      "My Shared Docs",
      "Tasks",
      "Projects",
      "Meetings",
    ]);
  });

  it("puts Review inside Knowledge for an approver, next to the base it reviews", () => {
    renderSidebar({ showReview: true });
    expect(primaryNavLabels()).toEqual([
      "Home",
      "Knowledge base",
      "Review",
      "Artifacts",
      "My Shared Docs",
      "Tasks",
      "Projects",
      "Meetings",
    ]);
    expect(screen.getAllByRole("link", { name: /^review$/i })[0]).toHaveAttribute("href", "/review");
  });

  it("keeps Review in Knowledge and People in Work when both are on", () => {
    renderSidebar({ showPeople: true, showReview: true });
    expect(primaryNavLabels()).toEqual([
      "Home",
      "Knowledge base",
      "Review",
      "Artifacts",
      "My Shared Docs",
      "Tasks",
      "Projects",
      "Meetings",
      "People",
    ]);
  });

  it("exposes the header Search control that opens the global palette", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const search = screen.getAllByRole("button", { name: /^search$/i });
    expect(search.length).toBeGreaterThan(0);
    // Clicking it opens the command palette dialog.
    await user.click(search[0]);
    expect(await screen.findByRole("dialog", { name: /global search/i })).toBeInTheDocument();
  });

  it("highlights the active route", () => {
    pathname.value = "/tasks";
    renderSidebar();
    expect(screen.getByRole("link", { name: /tasks/i })).toHaveAttribute(
      "data-active",
      "true",
    );
    pathname.value = "/";
  });

  it("shows the live Pinned and Recents groups fetched from the threads API", async () => {
    renderSidebar();
    // Pinned appears only once a pinned thread is fetched.
    expect(await screen.findAllByText("Pinned")).not.toHaveLength(0);
    expect(screen.getAllByText("Recents").length).toBeGreaterThan(0);
    // Both the desktop aside and mobile sheet render the list, so a fetched
    // thread appears (at least once) as a chat link.
    const links = await screen.findAllByRole("link", { name: /Points doctrine/i });
    expect(links[0]).toHaveAttribute("href", "/chat/s2");
  });

  it("exposes a hamburger to open the mobile drawer", () => {
    renderSidebar();
    expect(
      screen.getByRole("button", { name: /open menu/i }),
    ).toBeInTheDocument();
  });

  it("opens the drawer, then closes it when a nav link is followed", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // The drawer (Radix Sheet) is closed: its dialog is not mounted.
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toBeInTheDocument();

    // Following a nav link inside the drawer closes it (onNavigate).
    await user.click(within(drawer).getByRole("link", { name: /meetings/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
