import { describe, it, expect, afterEach } from "vitest";
import { isDocAnnotationsEnabled, isDocCopilotEnabled } from "./config";

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
  delete process.env.DOC_COPILOT_ENABLED;
});

describe("isDocAnnotationsEnabled", () => {
  it("is false when the shared-docs flag is off", () => {
    process.env.DOC_ANNOTATIONS_ENABLED = "1";
    expect(isDocAnnotationsEnabled()).toBe(false);
  });
  it("is false when only shared-docs is on", () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    expect(isDocAnnotationsEnabled()).toBe(false);
  });
  it("is true only when both are on", () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    process.env.DOC_ANNOTATIONS_ENABLED = "1";
    expect(isDocAnnotationsEnabled()).toBe(true);
  });
});

describe("isDocCopilotEnabled", () => {
  it("is false by default and false without the annotations chain", () => {
    expect(isDocCopilotEnabled()).toBe(false);
    process.env.DOC_COPILOT_ENABLED = "1";
    expect(isDocCopilotEnabled()).toBe(false);
    process.env.SHARED_DOCS_ENABLED = "1";
    expect(isDocCopilotEnabled()).toBe(false);
  });
  it("is true only when all three flags are on", () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    process.env.DOC_ANNOTATIONS_ENABLED = "1";
    process.env.DOC_COPILOT_ENABLED = "1";
    expect(isDocCopilotEnabled()).toBe(true);
  });
});
