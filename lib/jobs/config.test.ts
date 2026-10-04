import { afterEach, describe, expect, it } from "vitest";
import { checkCronSecret, cronSecret } from "./config";

afterEach(() => delete process.env.CRON_SECRET);

describe("cron config", () => {
  it("reads a trimmed CRON_SECRET", () => {
    process.env.CRON_SECRET = "  secret-value  ";
    expect(cronSecret()).toBe("secret-value");
  });

  it("fails closed when the secret is absent or mismatched", () => {
    expect(checkCronSecret("anything")).toBe(false);
    process.env.CRON_SECRET = "secret-value";
    expect(checkCronSecret(null)).toBe(false);
    expect(checkCronSecret("wrong")).toBe(false);
    expect(checkCronSecret("secret-value-extra")).toBe(false);
  });

  it("accepts an exact secret match", () => {
    process.env.CRON_SECRET = "secret-value";
    expect(checkCronSecret("secret-value")).toBe(true);
  });
});
