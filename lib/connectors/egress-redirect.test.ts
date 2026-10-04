import { describe, expect, it } from "vitest";
import { applyRedirectMethodRules, classifyRedirectStatus } from "./egress-redirect";

describe("classifyRedirectStatus", () => {
  it("classifies 301 and 302 as rewriting a post to a get", () => {
    expect(classifyRedirectStatus(301)).toBe("post-becomes-get");
    expect(classifyRedirectStatus(302)).toBe("post-becomes-get");
  });

  it("classifies 303 as always rewriting to a get", () => {
    expect(classifyRedirectStatus(303)).toBe("always-get");
  });

  it("classifies 307 and 308 as preserving the method and body", () => {
    expect(classifyRedirectStatus(307)).toBe("preserve");
    expect(classifyRedirectStatus(308)).toBe("preserve");
  });

  it("treats 304 as not a redirect at all", () => {
    expect(classifyRedirectStatus(304)).toBeNull();
  });

  it("treats an ordinary 200 as not a redirect at all", () => {
    expect(classifyRedirectStatus(200)).toBeNull();
  });
});

describe("applyRedirectMethodRules", () => {
  it("rewrites a post to a get and drops the body on a 303", () => {
    const hopInit: RequestInit = { method: "POST", body: "payload" };

    applyRedirectMethodRules(hopInit, "always-get");

    expect(hopInit.method).toBe("GET");
    expect(hopInit.body).toBeUndefined();
  });

  it("rewrites a post to a get on a 301 or 302", () => {
    const hopInit: RequestInit = { method: "POST", body: "payload" };

    applyRedirectMethodRules(hopInit, "post-becomes-get");

    expect(hopInit.method).toBe("GET");
    expect(hopInit.body).toBeUndefined();
  });

  it("leaves a get untouched on a 301 or 302", () => {
    const hopInit: RequestInit = { method: "GET" };

    applyRedirectMethodRules(hopInit, "post-becomes-get");

    expect(hopInit.method).toBe("GET");
  });

  it("preserves the method and body on a 307 or 308", () => {
    const hopInit: RequestInit = { method: "POST", body: "payload" };

    applyRedirectMethodRules(hopInit, "preserve");

    expect(hopInit.method).toBe("POST");
    expect(hopInit.body).toBe("payload");
  });

  it("treats a missing method as a get for the purposes of the rewrite rule", () => {
    const hopInit: RequestInit = {};

    applyRedirectMethodRules(hopInit, "post-becomes-get");

    expect(hopInit.method).toBeUndefined();
  });
});
