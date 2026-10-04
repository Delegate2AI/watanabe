import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMarketplaceIndex,
  MAX_INDEX_ITEMS,
  MAX_ITEM_DESCRIPTION_CHARS,
  MAX_ITEM_NAME_CHARS,
} from "./marketplace";

/**
 * Entry-level parsing of a remote index. Every entry is validated on its own,
 * so one malformed entry lands in `errors` while the healthy ones still parse,
 * and every string that reaches an admin screen is capped.
 */

const INDEX_URL = "https://skills.example.com/index.json";

/** A raw control character, spelled by code point so it stays visible in source. */
const BEL = String.fromCharCode(7);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(response: Response) {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

const item = (over: Record<string, unknown> = {}) => ({
  name: "Brand guidelines",
  description: "How we write.",
  url: "https://gitlab.example.com/acme/skills.git",
  ...over,
});

const load = (body: unknown) => fetchMarketplaceIndex(INDEX_URL, fakeFetch(jsonResponse(body)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("marketplace entries, well-formed", () => {
  it("parses a well-formed index", async () => {
    const result = await load({
      skills: [item({ ref: "main", subdir: "skills/brand" }), item({ name: "Runbooks" })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      {
        name: "Brand guidelines",
        description: "How we write.",
        url: "https://gitlab.example.com/acme/skills.git",
        ref: "main",
        subdir: "skills/brand",
      },
      {
        name: "Runbooks",
        description: "How we write.",
        url: "https://gitlab.example.com/acme/skills.git",
      },
    ]);
  });

  it("defaults a missing description to an empty string", async () => {
    const result = await load({ skills: [{ name: "Brand", url: "https://x.example.com/s.git" }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]?.description).toBe("");
  });

  it("ignores extra metadata fields a third-party index may carry", async () => {
    const result = await load({ skills: [item({ author: "someone", version: 3 })] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(["description", "name", "url"]);
  });

  it("strips control characters and collapses whitespace in displayed strings", async () => {
    const result = await load({
      skills: [item({ name: "Brand  \n guidelines", description: `a${BEL}b` })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]?.name).toBe("Brand guidelines");
    expect(result.items[0]?.description).toBe("ab");
  });
});

describe("marketplace entries, url scheme", () => {
  /**
   * A marketplace url ends up as a git remote, and `checkGitRemote`
   * deliberately accepts local and non-http remotes for the MANUAL git tab. An
   * entry from a remote JSON document is not a deliberate admin choice about a
   * named remote, so an index may never point the server at its own disk.
   */
  const localish = [
    "file:///srv/git/internal-runbooks.git",
    "/srv/git/internal-runbooks.git",
    "git@gitlab.example.com:acme/skills.git",
    "ssh://git@gitlab.example.com/acme/skills.git",
    "git://gitlab.example.com/acme/skills.git",
    "ext::sh -c whoami",
    "--upload-pack=touch /tmp/pwned",
  ];

  for (const url of localish) {
    it(`drops an entry whose url is "${url}"`, async () => {
      const result = await load({ skills: [item({ url }), item({ name: "Fine" })] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.items.map((i) => i.name)).toEqual(["Fine"]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain("http");
    });
  }

  it("keeps http and https entries", async () => {
    const result = await load({
      skills: [
        item({ name: "Plain", url: "http://gitlab.example.com/acme/skills.git" }),
        item({ name: "Secure", url: "https://gitlab.example.com/acme/skills.git" }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.name)).toEqual(["Plain", "Secure"]);
    expect(result.errors).toEqual([]);
  });
});

describe("marketplace entries, per-entry isolation", () => {
  it("drops an entry missing url and keeps the healthy ones", async () => {
    const result = await load({
      skills: [item(), { name: "Broken", description: "no url" }, item({ name: "Runbooks" })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.name)).toEqual(["Brand guidelines", "Runbooks"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain("url");
  });

  it("drops a null entry without failing the index", async () => {
    const result = await load({ skills: [null, item()] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("drops an entry whose name or description blows the display caps", async () => {
    const result = await load({
      skills: [
        item({ name: "n".repeat(MAX_ITEM_NAME_CHARS + 1) }),
        item({ description: "d".repeat(MAX_ITEM_DESCRIPTION_CHARS + 1) }),
        item({ name: "Fine" }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.name)).toEqual(["Fine"]);
    expect(result.errors).toHaveLength(2);
  });

  it("caps how many entries it surfaces and says how many it dropped", async () => {
    const skills = Array.from({ length: MAX_INDEX_ITEMS + 5 }, (_, i) => item({ name: `Skill ${i}` }));

    const result = await load({ skills });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(MAX_INDEX_ITEMS);
    expect(result.errors.some((e) => e.reason.includes("5"))).toBe(true);
  });

  it("names the offending entry in each error so an admin can find it", async () => {
    const result = await load({ skills: [{ name: "Broken", description: "no url" }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors[0]?.item).toContain("Broken");
  });
});
