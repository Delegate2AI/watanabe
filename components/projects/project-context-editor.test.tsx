// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectContextEditor } from "./project-context-editor";

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

const notifySuccess = vi.fn();
const notifyFailure = vi.fn();
vi.mock("@/lib/ui/toast", () => ({
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyFailure: (...args: unknown[]) => notifyFailure(...args),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  routerRefresh.mockReset();
  notifySuccess.mockReset();
  notifyFailure.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor(props: Partial<React.ComponentProps<typeof ProjectContextEditor>> = {}) {
  return render(
    <ProjectContextEditor
      projectId="p1"
      description="Ship the launch"
      context="Prefer short answers"
      canEdit
      {...props}
    />,
  );
}

describe("ProjectContextEditor", () => {
  it("reads as prose by default, with no form in sight", () => {
    renderEditor();
    expect(screen.getByText("Ship the launch")).toBeTruthy();
    expect(screen.getByText("Prefer short answers")).toBeTruthy();
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers Edit only to someone who may edit", () => {
    renderEditor({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("disables Save until the form is actually dirty", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Description"), " now");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("re-disables Save when the edit is typed back to where it started", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Description");
    await userEvent.type(input, "x");
    await userEvent.type(input, "{backspace}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves through the toast path and returns to read mode", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Description"), " now");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Project updated.", undefined));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("reports a failure through the toast path and stays in the form", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { code: "needs_role" } }) });
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Description"), " now");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(notifyFailure).toHaveBeenCalledWith("You need editor access to do that. Ask an admin."),
    );
    expect(screen.getByLabelText("Description")).toBeTruthy();
  });

  it("restores the saved values on cancel", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("Description"), " and more");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Ship the launch")).toBeTruthy();
  });
});
