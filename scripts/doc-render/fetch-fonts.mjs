/**
 * Downloads the font families a designed document may use, at IMAGE BUILD time.
 *
 * The exported `.html` has to open from a Downloads folder with no network, and
 * the PDF has to come out identical on every run, so a page may not fetch a font
 * at render time. The families are baked into the image instead and inlined as
 * data URIs by the server.
 *
 * The list is fixed on purpose. Adding a family means rebuilding this image,
 * which is the price of a reproducible PDF, and the system prompt names the same
 * list so the assistant only reaches for what is actually here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2] ?? "/opt/fonts";

/** family -> the CSS2 query that selects the weights a document uses. */
const FAMILIES = {
  Fraunces: "Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600",
  "Source Serif 4": "Source+Serif+4:opsz,wght@8..60,400;8..60,600",
  "JetBrains Mono": "JetBrains+Mono:wght@500;600",
  Inter: "Inter:wght@400;500;600;700",
};

// A modern browser UA, because the CSS2 endpoint serves woff2 only to clients it
// believes support it. Without this it answers with truetype, which is several
// times larger and defeats the point of inlining.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const sheets = [];

  for (const [family, query] of Object.entries(FAMILIES)) {
    const css = await fetchText(`https://fonts.googleapis.com/css2?family=${query}&display=swap`);
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
    if (urls.length === 0) throw new Error(`no woff2 found for ${family}`);

    // One file per family is enough: the sheet keeps every @font-face rule and
    // each is rewritten to the data URI of the file it named.
    let rewritten = css;
    for (const url of new Set(urls)) {
      const response = await fetch(url, { headers: { "user-agent": UA } });
      if (!response.ok) throw new Error(`${url} -> ${response.status}`);
      const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
      rewritten = rewritten.split(url).join(`data:font/woff2;base64,${base64}`);
    }
    sheets.push(rewritten);
    console.log(`bundled ${family} (${urls.length} files)`);
  }

  writeFileSync(path.join(OUT, "fonts.css"), sheets.join("\n"), "utf8");
}

main().catch((error) => {
  console.error(`font bundling failed: ${error.message}`);
  process.exit(1);
});
