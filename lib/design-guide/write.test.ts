import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

const invalidateSpy = vi.fn();
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    invalidateDesignGuideCache: () => {
      invalidateSpy();
      actual.invalidateDesignGuideCache();
    },
  };
});

import { DESIGN_GUIDE_ACCESS_PATH } from "./config";
import { writeDesignGuide } from "./write";

/**
 * The write half. Everything git is mocked: the commit path itself is covered
 * by `lib/repo-write-private-access`, and what matters here is that a caller
 * without the capability never reaches it, that a contradictory guide never
 * reaches it, and that a successful commit clears the read cache.
 */

beforeEach(() => {
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  invalidateSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const GUIDE = "HOUSE STYLE\n\nOne accent colour. Wide margins.";

describe("writeDesignGuide", () => {
  it("commits the guide to the private access ref", async () => {
    await expect(writeDesignGuide(GUIDE, "admin@example.com")).resolves.toEqual({ ok: true });
    const [files, options] = commitPrivateAccessMock.mock.calls[0];
    expect(files).toEqual({ [DESIGN_GUIDE_ACCESS_PATH]: `${GUIDE}\n` });
    expect(options.authorEmail).toBe("admin@example.com");
    expect(options.message).toMatch(/design guide/);
  });

  it("refuses a caller without manageAccess, before any commit is attempted", () => {
    canMock.mockReturnValue(false);
    return writeDesignGuide(GUIDE, "viewer@example.com").then((result) => {
      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(commitPrivateAccessMock).not.toHaveBeenCalled();
    });
  });

  it("checks the capability against the normalised address", async () => {
    await writeDesignGuide(GUIDE, "  Admin@Example.com  ");
    expect(canMock).toHaveBeenCalledWith("admin@example.com", "manageAccess");
  });

  it("refuses a guide that contradicts the constraints, and says where", async () => {
    const result = await writeDesignGuide("HOUSE\n<script>x</script>", "admin@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid design guide");
      expect(result.problems?.[0].line).toBe(2);
    }
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an empty guide rather than storing one", async () => {
    // Restoring the built-in guide is a write of the default, not a delete: a
    // stored empty file would read back as the default anyway, so an admin
    // clearing the box would see no change and not know why.
    const result = await writeDesignGuide("", "admin@example.com");
    expect(result.ok).toBe(false);
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("clears the override when the built-in guide is saved, rather than freezing a copy", async () => {
    // A stored copy of the default is frozen: the surface would keep reporting
    // an edited guide, and later improvements to the shipped one would never
    // reach this deployment. The loader reads an empty file as "no override".
    await writeDesignGuide(DEFAULT_DESIGN_HOUSE_STYLE, "admin@example.com");
    const [files, options] = commitPrivateAccessMock.mock.calls[0];
    expect(files[DESIGN_GUIDE_ACCESS_PATH]).toBe("");
    expect(options.message).toMatch(/restore/i);
  });

  it("normalises carriage returns, so a paste is not a whole-file diff", async () => {
    await writeDesignGuide("HOUSE STYLE\r\n\r\nWide margins.", "admin@example.com");
    expect(commitPrivateAccessMock.mock.calls[0][0][DESIGN_GUIDE_ACCESS_PATH]).toBe(
      "HOUSE STYLE\n\nWide margins.\n",
    );
  });

  it("clears the read cache on success, so the next session sees the edit", async () => {
    await writeDesignGuide(GUIDE, "admin@example.com");
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("does not clear the read cache when the commit failed", async () => {
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "private access checkout unavailable" });
    const result = await writeDesignGuide(GUIDE, "admin@example.com");
    expect(result).toEqual({ ok: false, error: "private access checkout unavailable" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
