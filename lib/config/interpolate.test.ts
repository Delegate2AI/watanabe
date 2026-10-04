import { describe, it, expect } from "vitest";
import { interpolate, ConfigError } from "./interpolate";

const env = (o: Record<string, string>) => o;

describe("interpolate", () => {
  it("substitutes a ${VAR} from the environment", () => {
    expect(interpolate({ a: "${FOO}" }, env({ FOO: "bar" }))).toEqual({ a: "bar" });
  });

  it("substitutes inside a larger string", () => {
    expect(interpolate({ a: "x-${FOO}-y" }, env({ FOO: "bar" }))).toEqual({ a: "x-bar-y" });
  });

  it("substitutes several vars in one string", () => {
    const out = interpolate({ a: "${A}/${B}" }, env({ A: "1", B: "2" }));
    expect(out).toEqual({ a: "1/2" });
  });

  it("recurses into nested objects and arrays", () => {
    const input = { auth: { jwt: { secret: "${S}" } }, list: ["${A}", { b: "${B}" }] };
    const out = interpolate(input, env({ S: "sh", A: "a", B: "b" }));
    expect(out).toEqual({ auth: { jwt: { secret: "sh" } }, list: ["a", { b: "b" }] });
  });

  it("leaves non-string scalars untouched", () => {
    expect(interpolate({ n: 1, b: true, z: null }, env({}))).toEqual({ n: 1, b: true, z: null });
  });

  // The escape exists so a literal ${...} can survive into a value (e.g. a
  // prompt template). Without it there would be no way to write one.
  it("treats $${VAR} as a literal ${VAR} and does not resolve it", () => {
    expect(interpolate({ a: "$${FOO}" }, env({ FOO: "bar" }))).toEqual({ a: "${FOO}" });
  });

  // Non-recursion matters: a secret whose VALUE happens to contain ${...} must
  // not trigger a second lookup. That would be a config-injection primitive.
  it("does not re-interpolate a substituted value", () => {
    const out = interpolate({ a: "${OUTER}" }, env({ OUTER: "${INNER}", INNER: "leaked" }));
    expect(out).toEqual({ a: "${INNER}" });
  });

  it("throws naming both the path and the variable when unset", () => {
    expect(() => interpolate({ auth: { jwt: { secret: "${MISSING}" } } }, env({}))).toThrowError(
      /auth\.jwt\.secret.*\$\{MISSING\}/s,
    );
  });

  it("throws a ConfigError, not a bare Error", () => {
    expect(() => interpolate({ a: "${MISSING}" }, env({}))).toThrowError(ConfigError);
  });

  // An empty string is indistinguishable from unset for a secret, and silently
  // booting with secret: "" is worse than refusing to boot.
  it("treats an empty variable as unset", () => {
    expect(() => interpolate({ a: "${EMPTY}" }, env({ EMPTY: "" }))).toThrowError(/\$\{EMPTY\}/);
  });

  it("reports an array index in the path", () => {
    expect(() => interpolate({ list: ["ok", "${GONE}"] }, env({}))).toThrowError(/list\[1\]/);
  });
});
