// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => successMock(...args),
    error: (...args: unknown[]) => errorMock(...args),
  },
}));

const { notifyFailure, notifySuccess } = await import("./toast");

beforeEach(() => {
  successMock.mockReset();
  errorMock.mockReset();
});

describe("notifySuccess", () => {
  it("raises a success toast carrying the copy it was given", () => {
    notifySuccess("Assigned to Maria Chen");
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(successMock.mock.calls[0]?.[0]).toBe("Assigned to Maria Chen");
  });

  it("attaches an action when one is offered, so a reversible change can be undone", () => {
    const onClick = vi.fn();
    notifySuccess("Removed from the project", { label: "Undo", onClick });
    const options = successMock.mock.calls[0]?.[1] as { action?: { label: string; onClick: () => void } };
    expect(options.action?.label).toBe("Undo");
    options.action?.onClick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("attaches no action when none is offered", () => {
    notifySuccess("Saved");
    const options = successMock.mock.calls[0]?.[1] as { action?: unknown } | undefined;
    expect(options?.action).toBeUndefined();
  });

  it("swallows a toast library failure rather than throwing into the caller", () => {
    successMock.mockImplementation(() => {
      throw new Error("toaster is not mounted");
    });
    expect(() => notifySuccess("Saved")).not.toThrow();
  });
});

describe("notifyFailure", () => {
  it("raises an error toast carrying the mapped copy", () => {
    notifyFailure("You are not cleared for this item.");
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]?.[0]).toBe("You are not cleared for this item.");
  });

  it("swallows a toast library failure rather than throwing into the caller", () => {
    errorMock.mockImplementation(() => {
      throw new Error("toaster is not mounted");
    });
    expect(() => notifyFailure("Something went wrong.")).not.toThrow();
  });
});
