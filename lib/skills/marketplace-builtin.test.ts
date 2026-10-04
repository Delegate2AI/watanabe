import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_MARKETPLACE_ID, parseMarketplaceIndex } from "./marketplace";
import {
  BUILTIN_INDEX_DOCUMENT_FOR_TEST,
  isBuiltinMarketplaceEnabled,
  marketplaceSourceIds,
  resolveMarketplaceIndex,
} from "./marketplace-builtin";

const getConfigMock = vi.fn();
vi.mock("@/lib/config", () => ({
  getConfig: () => getConfigMock(),
}));

afterEach(() => {
  getConfigMock.mockReset();
});

/** The shipped default: nothing configured, built-in left alone. */
function defaultConfig() {
  getConfigMock.mockReturnValue({});
}

describe("the bundled index document", () => {
  it("parses through the same parser a remote index goes through, with no errors", () => {
    const index = parseMarketplaceIndex(BUILTIN_INDEX_DOCUMENT_FOR_TEST);

    expect(index.ok).toBe(true);
    if (!index.ok) return;
    // Not "some items survived": every entry must pass, or the app ships a
    // catalog whose broken rows an admin sees before we do.
    expect(index.errors).toEqual([]);
    expect(index.items.length).toBeGreaterThan(0);
  });

  it("lists only http(s) urls, which is what keeps a pick out of the local filesystem", () => {
    const index = parseMarketplaceIndex(BUILTIN_INDEX_DOCUMENT_FOR_TEST);
    if (!index.ok) throw new Error("the bundled index must parse");

    for (const item of index.items) {
      expect(item.url.startsWith("https://")).toBe(true);
    }
  });

  it("names every entry uniquely, since a pick is matched by name and url", () => {
    const index = parseMarketplaceIndex(BUILTIN_INDEX_DOCUMENT_FOR_TEST);
    if (!index.ok) throw new Error("the bundled index must parse");

    const names = index.items.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships none of the source-available document skills", () => {
    // docx, pdf, pptx and xlsx are not Apache 2.0: their licence forbids
    // retaining copies outside Anthropic's services, and installing retains a
    // copy on this server's volume. An admin can still install them by url.
    const index = parseMarketplaceIndex(BUILTIN_INDEX_DOCUMENT_FOR_TEST);
    if (!index.ok) throw new Error("the bundled index must parse");

    const names = new Set(index.items.map((item) => item.name));
    for (const restricted of ["docx", "pdf", "pptx", "xlsx", "doc-coauthoring"]) {
      expect(names.has(restricted)).toBe(false);
    }
  });
});

describe("marketplaceSourceIds", () => {
  it("offers the built-in index when nothing is configured", () => {
    defaultConfig();

    expect(marketplaceSourceIds()).toEqual([BUILTIN_MARKETPLACE_ID]);
  });

  it("puts an operator's own indexes ahead of the built-in one", () => {
    getConfigMock.mockReturnValue({ skills: { marketplaces: ["https://example.com/index.json"] } });

    expect(marketplaceSourceIds()).toEqual([
      "https://example.com/index.json",
      BUILTIN_MARKETPLACE_ID,
    ]);
  });

  it("drops the built-in index when an operator turns it off", () => {
    getConfigMock.mockReturnValue({
      skills: { marketplaces: ["https://example.com/index.json"], builtinMarketplace: false },
    });

    expect(marketplaceSourceIds()).toEqual(["https://example.com/index.json"]);
  });

  it("offers nothing at all when the built-in is off and nothing is configured", () => {
    getConfigMock.mockReturnValue({ skills: { builtinMarketplace: false } });

    expect(marketplaceSourceIds()).toEqual([]);
  });

  it("degrades to no marketplace when the config throws", () => {
    getConfigMock.mockImplementation(() => {
      throw new Error("portal.yaml is malformed");
    });

    expect(isBuiltinMarketplaceEnabled()).toBe(false);
    expect(marketplaceSourceIds()).toEqual([]);
  });
});

describe("resolveMarketplaceIndex", () => {
  it("resolves the built-in id from the bundled document without touching the network", async () => {
    defaultConfig();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const index = await resolveMarketplaceIndex(BUILTIN_MARKETPLACE_ID);

    expect(index.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses a near-miss of the sentinel rather than treating it as built in", async () => {
    // The match is exact equality against a constant. Anything else takes the
    // fetch path, where the scheme allow-list refuses a non-http(s) source.
    defaultConfig();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const index = await resolveMarketplaceIndex(`${BUILTIN_MARKETPLACE_ID} `);

    expect(index.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
