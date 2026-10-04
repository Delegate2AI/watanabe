import { afterEach, describe, expect, it } from "vitest";
import { interpolate } from "@/lib/config/interpolate";
import { connectorEnvVars } from "./store";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("connectorEnvVars", () => {
  it("reports every referenced variable once, sorted, with presence only", () => {
    process.env.LINEAR_TOKEN = "secret-value";
    delete process.env.OTHER_TOKEN;

    const vars = connectorEnvVars({
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}", "X-Extra": "${OTHER_TOKEN}" },
      env: { AGAIN: "${LINEAR_TOKEN}" },
    });

    expect(vars).toEqual([
      { name: "LINEAR_TOKEN", present: true },
      { name: "OTHER_TOKEN", present: false },
    ]);
    expect(JSON.stringify(vars)).not.toContain("secret-value");
  });

  it("ignores an escaped $${VAR}, which interpolation renders literally", () => {
    expect(connectorEnvVars({ headers: { "X-Literal": "$${NOT_A_REF}" } })).toEqual([]);
  });

  it("returns an empty list for an entry with no headers or env", () => {
    expect(connectorEnvVars({})).toEqual([]);
  });

  it("reports the variable an oauthClientSecret references", () => {
    process.env.OAUTH_SECRET = "set";

    expect(connectorEnvVars({ oauthClientSecret: "${OAUTH_SECRET}" })).toEqual([
      { name: "OAUTH_SECRET", present: true },
    ]);
  });

  it("reports a variable interpolation resolves but an upper-case regex would miss", () => {
    process.env.circleback_token = "set";

    expect(connectorEnvVars({ headers: { Authorization: "Bearer ${circleback_token}" } })).toEqual([
      { name: "circleback_token", present: true },
    ]);
  });

  it("counts an empty variable as absent, because interpolation throws on it", () => {
    process.env.BLANK_TOKEN = "";

    expect(connectorEnvVars({ env: { TOKEN: "${BLANK_TOKEN}" } })).toEqual([
      { name: "BLANK_TOKEN", present: false },
    ]);
  });

  it("agrees with interpolate about every variable it reports", () => {
    process.env.SET_TOKEN = "value";
    process.env.BLANK_TOKEN = "";
    delete process.env.ABSENT_TOKEN;
    const headers = {
      A: "${SET_TOKEN}",
      B: "${BLANK_TOKEN}",
      C: "${ABSENT_TOKEN}",
      D: "${lower_token}",
    };

    for (const { name, present } of connectorEnvVars({ headers })) {
      let interpolates = true;
      try {
        interpolate(`\${${name}}`);
      } catch {
        interpolates = false;
      }
      expect(present).toBe(interpolates);
    }
  });
});
