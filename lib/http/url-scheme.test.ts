import { describe, it, expect } from "vitest";
import { isLoopbackHost, isHttpsOrLoopback } from "./url-scheme";

describe("isLoopbackHost", () => {
  it("recognizes localhost, 127.0.0.1, and ::1", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });

  it("refuses a real host", () => {
    expect(isLoopbackHost("portal.example.com")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
  });
});

describe("isHttpsOrLoopback", () => {
  it("accepts any https URL", () => {
    expect(isHttpsOrLoopback("https://portal.example.com")).toBe(true);
    expect(isHttpsOrLoopback("https://localhost:3100")).toBe(true);
  });

  it("accepts http only on a loopback host", () => {
    expect(isHttpsOrLoopback("http://localhost:3100")).toBe(true);
    expect(isHttpsOrLoopback("http://127.0.0.1:3100")).toBe(true);
    expect(isHttpsOrLoopback("http://[::1]:3100")).toBe(true);
  });

  it("rejects http on a real host", () => {
    expect(isHttpsOrLoopback("http://portal.example.com")).toBe(false);
    expect(isHttpsOrLoopback("http://idp.example.com/token")).toBe(false);
  });

  it("rejects a scheme that is neither http nor https", () => {
    expect(isHttpsOrLoopback("ftp://localhost/x")).toBe(false);
  });

  it("returns false, never throws, for a string that will not parse", () => {
    expect(isHttpsOrLoopback("not a url")).toBe(false);
  });
});
