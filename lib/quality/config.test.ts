import { afterEach, describe, expect, it } from "vitest";
import { isIntegrityEnabled, isQualityGatesEnabled } from "./config";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("quality config", () => {
  it("isQualityGatesEnabled only when QUALITY_GATES_ENABLED=1", () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    expect(isQualityGatesEnabled()).toBe(true);
    process.env.QUALITY_GATES_ENABLED = "0";
    expect(isQualityGatesEnabled()).toBe(false);
    delete process.env.QUALITY_GATES_ENABLED;
    expect(isQualityGatesEnabled()).toBe(false);
  });
});

describe("integrity config", () => {
  it("isIntegrityEnabled requires both INTEGRITY_ENABLED=1 and QUALITY_GATES_ENABLED=1", () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    process.env.INTEGRITY_ENABLED = "1";
    expect(isIntegrityEnabled()).toBe(true);

    process.env.INTEGRITY_ENABLED = "0";
    expect(isIntegrityEnabled()).toBe(false);

    process.env.INTEGRITY_ENABLED = "1";
    process.env.QUALITY_GATES_ENABLED = "0";
    expect(isIntegrityEnabled()).toBe(false);

    delete process.env.INTEGRITY_ENABLED;
    delete process.env.QUALITY_GATES_ENABLED;
    expect(isIntegrityEnabled()).toBe(false);
  });
});
