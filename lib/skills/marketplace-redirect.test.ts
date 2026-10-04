import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarketplaceIndex } from "./marketplace";
import { MAX_INDEX_REDIRECTS } from "./marketplace-http";

/**
 * Redirects on the marketplace index, followed by hand.
 *
 * `redirect: "follow"` applies the http(s) allow-list to the CONFIGURED url
 * only, so a configured index that has been compromised could send the request
 * anywhere and have the answer read, parsed, and reported back to an admin.
 * Every hop is re-checked here instead, and the chain is bounded.
 */

const INDEX_URL = "https://skills.example.com/index.json";

function redirect(location: string | null, status = 302): Response {
  const headers = new Headers();
  if (location !== null) headers.set("location", location);
  return new Response(null, { status, headers });
}

function index(): Response {
  return new Response(JSON.stringify({ skills: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Answers each call from the queue, so a chain can be scripted hop by hop. */
function fakeFetch(...responses: Response[]) {
  const queue = [...responses];
  const impl = vi.fn(async (url: string | URL) => {
    impl.urls.push(String(url));
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected extra fetch");
    return next;
  });
  impl.urls = [] as string[];
  return impl as unknown as typeof fetch & { urls: string[] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("marketplace index redirects", () => {
  it("follows an allowed hop and resolves a relative location against it", async () => {
    const impl = fakeFetch(redirect("/v2/index.json"), index());

    const result = await fetchMarketplaceIndex(INDEX_URL, impl);

    expect(result.ok).toBe(true);
    expect(impl.urls).toEqual([INDEX_URL, "https://skills.example.com/v2/index.json"]);
  });

  it("never lets the caller's fetch follow a redirect on its own", async () => {
    const impl = fakeFetch(redirect("https://skills.example.com/v2/index.json"), index());

    await fetchMarketplaceIndex(INDEX_URL, impl);

    const [, init] = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("refuses a hop to a scheme the allow-list does not carry", async () => {
    const impl = fakeFetch(redirect("file:///etc/passwd"));

    const result = await fetchMarketplaceIndex(INDEX_URL, impl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not allowed");
    expect(impl.urls).toEqual([INDEX_URL]);
  });

  it("does not echo the URL a remote redirected to", async () => {
    const impl = fakeFetch(redirect("data:text/plain,aws-secret"));

    const result = await fetchMarketplaceIndex(INDEX_URL, impl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("aws-secret");
  });

  it("refuses a redirect with no location", async () => {
    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(redirect(null)));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("without a location");
  });

  it("stops a chain at the hop budget rather than walking it", async () => {
    const hops = Array.from({ length: MAX_INDEX_REDIRECTS + 1 }, (_unused, position) =>
      redirect(`https://skills.example.com/hop-${position}.json`),
    );
    const impl = fakeFetch(...hops);

    const result = await fetchMarketplaceIndex(INDEX_URL, impl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("redirected more than");
    expect(impl.urls).toHaveLength(MAX_INDEX_REDIRECTS + 1);
  });
});
