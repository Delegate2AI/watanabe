// Registers jest-dom's custom matchers (toBeInTheDocument, toHaveClass, ...)
// on vitest's `expect`. Loaded as a global setup file; it only extends the
// matcher registry, so it is safe under both the node and jsdom environments.
import "@testing-library/jest-dom/vitest";

// jsdom does not implement `window.matchMedia`, which next-themes calls to read
// `prefers-color-scheme`. Provide an inert stub so theme-aware components render
// under the jsdom test environment. Guarded so it is a no-op in node tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom lacks the Pointer Capture and scrollIntoView APIs that Radix primitives
// (DropdownMenu, Dialog, Sheet, Tabs) call during open/close. These are the same
// class of jsdom gap as matchMedia above: inert polyfills so the mandated
// Testing-Library interaction tests run, not behavior stubs.
if (typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
}

// jsdom does not implement ResizeObserver, which Radix ScrollArea (the
// sidebar's Pinned/Recents scroll region) calls to measure content and decide
// whether to show its scrollbar. Same class of jsdom gap as above: an inert
// polyfill so components that use ScrollArea can mount under jsdom.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  class InertResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = InertResizeObserver as unknown as typeof ResizeObserver;
}
