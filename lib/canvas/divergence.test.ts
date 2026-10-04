import { describe, it, expect } from "vitest";
import { classifyUpdate } from "./divergence";

describe("classifyUpdate", () => {
  it("is up_to_date when the chat doc has no version past the promotion", () => {
    expect(
      classifyUpdate({
        chatCurrentVersion: 2,
        promotedVersion: 2,
        targetCurrentVersion: 1,
        targetVersionAtPromote: 1,
      }).status,
    ).toBe("up_to_date");
  });

  it("is chat_ahead when only the chat doc moved (target untouched since promote)", () => {
    const r = classifyUpdate({
      chatCurrentVersion: 3,
      promotedVersion: 2,
      targetCurrentVersion: 1,
      targetVersionAtPromote: 1,
    });
    expect(r.status).toBe("chat_ahead");
    expect(r.warn).toBe(false);
  });

  it("is diverged when the target also moved independently since the promotion", () => {
    const r = classifyUpdate({
      chatCurrentVersion: 3,
      promotedVersion: 2,
      targetCurrentVersion: 4,
      targetVersionAtPromote: 2,
    });
    expect(r.status).toBe("diverged");
    expect(r.warn).toBe(true);
    // The projected new target version is additive (current + 1), nothing lost.
    expect(r.projectedTargetVersion).toBe(5);
  });
});
