// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillAuthoring } from "./authoring";

const SKILLS = [
  { slug: "release-notes", title: "Release Notes", description: "How to write them", groups: ["engineering"], rev: "abc123" },
  { slug: "onboarding", title: "Onboarding", description: "For new hires", groups: ["hr"], rev: "def456" },
];

const STORED_BODY = "# Release notes\n\nGather the merged MRs.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(
  handlers: {
    list?: () => Response;
    read?: (slug: string) => Response;
    post?: (body: unknown) => Response;
    put?: (slug: string, body: unknown) => Response;
    del?: (slug: string) => Response;
  } = {},
) {
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/skills/authored" && init?.method === undefined) {
      return handlers.list?.() ?? json({ skills: SKILLS, grantGroups: ["engineering", "hr"] });
    }
    if (url === "/api/skills/authored" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return handlers.post?.(body) ?? json({ slug: "new-skill" });
    }
    const match = /^\/api\/skills\/authored\/(.+)$/.exec(url);
    if (match && init?.method === undefined) {
      const stored = SKILLS.find((skill) => skill.slug === match[1]);
      return handlers.read?.(match[1]) ?? json({ ...stored, body: STORED_BODY });
    }
    if (match && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return handlers.put?.(match[1], body) ?? json({ slug: match[1] });
    }
    if (match && init?.method === "DELETE") {
      return handlers.del?.(match[1]) ?? json({ removed: true });
    }
    return json({});
  });
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return impl;
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  const row = (await screen.findByText(title)).closest("article");
  if (!row) throw new Error("row not found");
  await user.click(within(row).getByRole("button", { name: /edit/i }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SkillAuthoring", () => {
  it("renders the caller's authored skills and bounds the group choices to grantGroups", async () => {
    stubFetch();
    render(<SkillAuthoring />);

    expect(await screen.findByText("Release Notes")).toBeInTheDocument();
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(screen.getByLabelText("engineering")).toBeInTheDocument();
    expect(screen.getByLabelText("hr")).toBeInTheDocument();
  });

  it("shows an empty state when the caller has authored nothing yet", async () => {
    stubFetch({ list: () => json({ skills: [], grantGroups: ["engineering"] }) });
    render(<SkillAuthoring />);

    expect(await screen.findByText(/have not authored any skills yet/i)).toBeInTheDocument();
  });

  it("posts the exact create body shape", async () => {
    const impl = stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);
    await screen.findByText("Release Notes");

    await user.type(screen.getByLabelText(/^title$/i), "New Skill");
    await user.type(screen.getByLabelText(/^description$/i), "Does a thing");
    await user.click(screen.getByLabelText("engineering"));
    await user.type(screen.getByLabelText(/skill content/i), "# Do the thing");
    await user.click(screen.getByRole("button", { name: /create skill/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith("/api/skills/authored", expect.objectContaining({ method: "POST" })),
    );
    const call = impl.mock.calls.find(([url, init]) => url === "/api/skills/authored" && init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      title: "New Skill",
      description: "Does a thing",
      body: "# Do the thing",
      groups: ["engineering"],
    });
  });

  it("edit reads the published body back and prefills the editor with it", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);

    await openEditor(user, "Release Notes");

    expect(await screen.findByLabelText(/skill content/i)).toHaveValue(STORED_BODY);
    expect(screen.getByLabelText(/^description$/i)).toHaveValue("How to write them");
  });

  it("keeps the slug-bearing title visible but not editable while editing", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);

    await openEditor(user, "Release Notes");

    const titleInput = await screen.findByLabelText(/^title$/i);
    expect(titleInput).toHaveValue("Release Notes");
    expect(titleInput).toHaveAttribute("readonly");
    await user.type(titleInput, "v2");
    expect(titleInput).toHaveValue("Release Notes");
  });

  it("PUTs the edited fields to the slug, and never a title the server would refuse", async () => {
    const impl = stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);

    await openEditor(user, "Release Notes");
    await user.type(await screen.findByLabelText(/skill content/i), "\nAnd the closed issues.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith(
        "/api/skills/authored/release-notes",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const call = impl.mock.calls.find(
      ([url, init]) => url === "/api/skills/authored/release-notes" && init?.method === "PUT",
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      description: "How to write them",
      groups: ["engineering"],
      body: `${STORED_BODY}\nAnd the closed issues.`,
    });
  });

  it("refuses to open the editor when the published body cannot be read back", async () => {
    const impl = stubFetch({ read: () => json({ error: { code: "needs_role" } }, 403) });
    const user = userEvent.setup();
    render(<SkillAuthoring />);

    await openEditor(user, "Release Notes");

    expect(await screen.findByRole("alert")).toHaveTextContent(/editor access/i);
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(impl).not.toHaveBeenCalledWith(
      "/api/skills/authored/release-notes",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("deletes only after the confirmation is accepted", async () => {
    const impl = stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);
    const releaseNotesRow = (await screen.findByText("Release Notes")).closest("article");
    if (!releaseNotesRow) throw new Error("row not found");

    vi.stubGlobal("confirm", vi.fn(() => false));
    await user.click(within(releaseNotesRow).getByRole("button", { name: /delete/i }));
    expect(impl).not.toHaveBeenCalledWith(
      "/api/skills/authored/release-notes",
      expect.objectContaining({ method: "DELETE" }),
    );

    vi.stubGlobal("confirm", vi.fn(() => true));
    await user.click(within(releaseNotesRow).getByRole("button", { name: /delete/i }));

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith(
        "/api/skills/authored/release-notes",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("keeps Create disabled until a group is chosen, so nothing publishes to nobody", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<SkillAuthoring />);
    await screen.findByText("Release Notes");

    await user.type(screen.getByLabelText(/^title$/i), "New Skill");
    await user.type(screen.getByLabelText(/^description$/i), "Does a thing");
    await user.type(screen.getByLabelText(/skill content/i), "# Do the thing");
    expect(screen.getByRole("button", { name: /create skill/i })).toBeDisabled();

    await user.click(screen.getByLabelText("engineering"));
    expect(screen.getByRole("button", { name: /create skill/i })).toBeEnabled();
  });

  it("surfaces the route's error message on a failed create", async () => {
    stubFetch({ post: () => json({ error: { code: "needs_role" } }, 403) });
    const user = userEvent.setup();
    render(<SkillAuthoring />);
    await screen.findByText("Release Notes");

    await user.type(screen.getByLabelText(/^title$/i), "New Skill");
    await user.type(screen.getByLabelText(/^description$/i), "Does a thing");
    await user.click(screen.getByLabelText("engineering"));
    await user.type(screen.getByLabelText(/skill content/i), "# Do the thing");
    await user.click(screen.getByRole("button", { name: /create skill/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/editor access/i);
  });
});
