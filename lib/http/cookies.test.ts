import { describe, it, expect } from "vitest";
import { serializeCookie, readCookie, expireCookie } from "./cookies";

describe("serializeCookie", () => {
  it("emits the flags it is given and nothing else", () => {
    const out = serializeCookie("a", "b", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(out).toBe("a=b; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax");
  });

  it("omits Secure when secure is false", () => {
    expect(serializeCookie("a", "b", { secure: false, path: "/" })).toBe("a=b; Path=/");
  });

  it("percent-encodes a value with reserved characters", () => {
    expect(serializeCookie("r", "/docs?a=1&b=2")).toBe("r=%2Fdocs%3Fa%3D1%26b%3D2");
  });
});

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("x=1; portal_session=abc; y=2", "portal_session")).toBe("abc");
  });

  it("decodes a percent-encoded value", () => {
    expect(readCookie("r=%2Fdocs%3Fa%3D1", "r")).toBe("/docs?a=1");
  });

  it("does not match a name that is a suffix of another", () => {
    expect(readCookie("not_portal_session=abc", "portal_session")).toBeNull();
  });

  it("returns null for absent, empty, and malformed headers", () => {
    expect(readCookie(null, "a")).toBeNull();
    expect(readCookie("", "a")).toBeNull();
    expect(readCookie("garbage", "a")).toBeNull();
    expect(readCookie("a=", "a")).toBeNull();
    expect(readCookie("a=%zz", "a")).toBeNull();
  });
});

describe("expireCookie", () => {
  it("clears with Max-Age=0", () => {
    expect(expireCookie("a", { path: "/" })).toBe("a=; Path=/; Max-Age=0");
  });
});
