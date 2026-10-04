import { describe, expect, it } from "vitest";
import * as seen from "./route";
import * as parent from "../route";

// The activity bell POSTs to /api/activity/seen; this asserts the segment exists
// and delegates to the parent POST handler (the previous mismatch 404'd in prod
// while the parent route test passed by calling POST directly).
describe("POST /api/activity/seen", () => {
  it("exposes the mark-seen POST handler at the /seen segment", () => {
    expect(typeof seen.POST).toBe("function");
    expect(seen.POST).toBe(parent.POST);
  });

  it("declares the required route runtime conventions", () => {
    expect(seen.dynamic).toBe("force-dynamic");
    expect(seen.runtime).toBe("nodejs");
  });
});
