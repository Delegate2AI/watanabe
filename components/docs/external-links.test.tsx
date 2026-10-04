// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExternalLinks } from "./external-links";
import type { DocLink } from "@/lib/shared-docs/types";

const notifySuccess = vi.fn();
const notifyFailure = vi.fn();
vi.mock("@/lib/ui/toast", () => ({
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyFailure: (...args: unknown[]) => notifyFailure(...args),
}));

const writeText = vi.fn(async () => {});

function link(overrides: Partial<DocLink> = {}): DocLink {
  return {
    token: "tok-active",
    docId: "d1",
    access: "view",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  notifySuccess.mockReset();
  notifyFailure.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ links: [] }) })));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExternalLinks", () => {
  it("renders the absolute URL, and it matches the route that serves the token", () => {
    render(<ExternalLinks id="d1" initialLinks={[link()]} />);
    const anchor = screen.getByRole("link", { name: `${window.location.origin}/docs/shared/tok-active` });
    // The href is the same path the app routes on: app/docs/shared/[token].
    expect(anchor).toHaveAttribute("href", "/docs/shared/tok-active");
  });

  it("copies the absolute URL and confirms", async () => {
    render(<ExternalLinks id="d1" initialLinks={[link()]} />);
    await userEvent.click(screen.getByRole("button", { name: /^Copy link/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/docs/shared/tok-active`);
    expect(notifySuccess).toHaveBeenCalledWith("Link copied.");
  });

  it("says what the link grants, when it was created, and when it expires", () => {
    render(<ExternalLinks id="d1" initialLinks={[link({ access: "comment" })]} />);
    const row = screen.getByRole("link", { name: /docs\/shared\/tok-active/ }).closest("li")!;
    expect(within(row).getByText("Can comment")).toBeTruthy();
    // The day is read in the viewer's own timezone, so the year and month are
    // what is stable to assert on here.
    expect(within(row).getByText(/^Created \d+ Jul 2026$/)).toBeTruthy();
    expect(within(row).getByText(/^Expires /)).toBeTruthy();
  });

  it("says so plainly when a link never expires", () => {
    render(<ExternalLinks id="d1" initialLinks={[link({ expiresAt: null })]} />);
    expect(screen.getByText("No expiry")).toBeTruthy();
  });

  it("marks an expired link and sorts it below the active ones", () => {
    const { container } = render(
      <ExternalLinks
        id="d1"
        initialLinks={[
          link({ token: "tok-dead", expiresAt: "2020-01-01T00:00:00.000Z", createdAt: "2020-01-01T00:00:00.000Z" }),
          link({ token: "tok-active" }),
        ]}
      />,
    );
    expect(screen.getByText(/^Expired /)).toBeTruthy();

    const rows = Array.from(container.querySelectorAll("li"));
    expect(rows[0].textContent).toContain("tok-active");
    expect(rows[1].textContent).toContain("tok-dead");
  });

  it("tells the person to copy by hand when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<ExternalLinks id="d1" initialLinks={[link()]} />);
    await userEvent.click(screen.getByRole("button", { name: /^Copy link/ }));
    expect(notifyFailure).toHaveBeenCalledWith("Could not copy the link. Select it and copy by hand.");
  });
});
