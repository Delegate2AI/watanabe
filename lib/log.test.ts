import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { log, setErrorSink } from "./log";

const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  stdout.mockClear();
  stderr.mockClear();
});

afterEach(() => {
  setErrorSink(null);
});

describe("log", () => {
  it("writes one JSON object per line, info to stdout and the rest to stderr", () => {
    log.info("hello", { a: 1 });
    log.warn("careful");
    log.error("broke", { op: "write" });
    expect(JSON.parse(stdout.mock.calls[0][0] as string)).toEqual({ level: "info", msg: "hello", a: 1 });
    expect(JSON.parse(stderr.mock.calls[0][0] as string)).toEqual({ level: "warn", msg: "careful" });
    expect(JSON.parse(stderr.mock.calls[1][0] as string)).toEqual({ level: "error", msg: "broke", op: "write" });
  });

  it("falls back rather than throwing on unserializable fields", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => log.info("cyclic", cycle)).not.toThrow();
    expect(JSON.parse(stdout.mock.calls[0][0] as string)).toMatchObject({ logError: "unserializable fields" });
  });
});

describe("setErrorSink", () => {
  it("hands every error to the sink, with the fields it was logged with", () => {
    const seen: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
    setErrorSink((msg, fields) => seen.push({ msg, fields }));
    log.error("db write failed", { op: "recordThread" });
    expect(seen).toEqual([{ msg: "db write failed", fields: { op: "recordThread" } }]);
  });

  it("leaves info and warn alone, so the sink only ever sees failures", () => {
    const seen: string[] = [];
    setErrorSink((msg) => seen.push(msg));
    log.info("fine");
    log.warn("odd");
    expect(seen).toEqual([]);
  });

  it("still writes the line when the sink itself throws", () => {
    setErrorSink(() => {
      throw new Error("sink down");
    });
    expect(() => log.error("broke")).not.toThrow();
    expect(JSON.parse(stderr.mock.calls[0][0] as string)).toMatchObject({ msg: "broke" });
  });

  it("can be cleared", () => {
    const seen: string[] = [];
    setErrorSink((msg) => seen.push(msg));
    setErrorSink(null);
    log.error("broke");
    expect(seen).toEqual([]);
  });
});
