// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { AnalyticsProvider } from "./analytics-provider";

const init = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
let persistedId: string | undefined;
const capture = vi.fn();
const captureException = vi.fn();
vi.mock("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => init(...args),
    identify: (...args: unknown[]) => identify(...args),
    reset: () => reset(),
    get_distinct_id: () => persistedId,
    capture: (...args: unknown[]) => capture(...args),
    captureException: (...args: unknown[]) => captureException(...args),
  },
}));

const PROPS = { apiKey: "phc_test", distinctId: "a1b2c3", host: "https://posthog.example.com" };

beforeEach(() => {
  persistedId = undefined;
  reset.mockClear();
  init.mockClear();
  identify.mockClear();
  capture.mockClear();
  captureException.mockClear();
});

describe("AnalyticsProvider", () => {
  it("posts straight to the self-hosted instance, which is not behind the edge that blocks uploads", () => {
    render(<AnalyticsProvider {...PROPS} />);
    const [key, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe("phc_test");
    expect(options.api_host).toBe(PROPS.host);
  });

  it("leaves a client-side navigation to the SDK rather than capturing it by hand", () => {
    render(<AnalyticsProvider {...PROPS} />);
    const [, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.capture_pageview).toBe("history_change");
  });

  it("does not start at all for someone who asked not to be tracked", () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "doNotTrack");
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    render(<AnalyticsProvider {...PROPS} />);
    expect(init).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    if (original) Object.defineProperty(Navigator.prototype, "doNotTrack", original);
    else Object.defineProperty(navigator, "doNotTrack", { value: undefined, configurable: true });
  });

  it("records nobody's screen and nobody's address", () => {
    render(<AnalyticsProvider {...PROPS} />);
    const [, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.disable_session_recording).toBe(true);
    expect(identify).toHaveBeenCalledWith("a1b2c3");
    expect(JSON.stringify(identify.mock.calls)).not.toContain("@");
  });

  it("masks the text and attributes autocapture would otherwise send", () => {
    render(<AnalyticsProvider {...PROPS} />);
    const [, options] = init.mock.calls[0] as [string, Record<string, unknown>];
    // The admin screens put staff addresses in both.
    expect(options.mask_all_text).toBe(true);
    expect(options.mask_all_element_attributes).toBe(true);
  });

  it("clears the previous person before identifying a new one on a shared browser", () => {
    persistedId = "f".repeat(32);
    render(<AnalyticsProvider {...PROPS} />);
    expect(reset).toHaveBeenCalled();
    expect(identify).toHaveBeenCalledWith("a1b2c3");
  });

  it("does not reset for the same person returning", () => {
    persistedId = "a1b2c3";
    render(<AnalyticsProvider {...PROPS} />);
    expect(reset).not.toHaveBeenCalled();
  });

  it("does not reset over an anonymous id, which would drop nothing worth keeping", () => {
    persistedId = "0193f0aa-1b2c-7000-8000-abcdefabcdef";
    render(<AnalyticsProvider {...PROPS} />);
    expect(reset).not.toHaveBeenCalled();
  });

  it("starts once, however often the shell re-renders", () => {
    const { rerender } = render(<AnalyticsProvider {...PROPS} />);
    rerender(<AnalyticsProvider {...PROPS} />);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("captures an uncaught error and an unhandled rejection", () => {
    render(<AnalyticsProvider {...PROPS} />);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      expect.anything(),
    );

    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("nope");
    window.dispatchEvent(rejection);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "nope" }),
      expect.anything(),
    );
  });

  it("names the page the error happened on, so a report points somewhere", () => {
    render(<AnalyticsProvider {...PROPS} />);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: window.location.pathname }),
    );
  });

  it("stops listening when the shell unmounts", () => {
    const { unmount } = render(<AnalyticsProvider {...PROPS} />);
    unmount();
    capture.mockClear();
    // Swallows the event so the test runner does not report the unhandled
    // error this deliberately raises with nothing left listening.
    window.addEventListener("error", (event) => event.preventDefault(), { once: true });
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("after"), message: "after", cancelable: true }));
    expect(capture).not.toHaveBeenCalled();
  });
});
