/**
 * The document render sidecar: markup in, a PDF and a self-contained page out.
 *
 * Deliberately dumb. It holds no state, reads no database, has no notion of who
 * a user is, and is reachable only in-cluster through its ClusterIP service. The
 * portal is the only client, and the only thing it can ask for is "draw this".
 *
 * Three things happen to a page before it is printed:
 *  1. Any remote stylesheet link is dropped and the bundled fonts are inlined,
 *     so the exported file opens with no network and the PDF is reproducible.
 *  2. Any `<pre class="mermaid">` becomes an inline SVG.
 *  3. It is printed to PDF, and the mutated DOM is returned as the `.html`.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { marked } from "marked";

const PORT = Number(process.env.RENDER_PORT ?? 8791);
const HOST = process.env.RENDER_HOST ?? "0.0.0.0";
const FONTS_DIR = process.env.FONTS_DIR ?? "/opt/fonts";
const ASSETS_DIR = process.env.ASSETS_DIR ?? "/opt/assets";
/** Bounded so a hostile or runaway body cannot make this buffer without limit. */
const MAX_BODY_BYTES = Number(process.env.RENDER_MAX_BYTES ?? 8 * 1024 * 1024);
const NAV_TIMEOUT_MS = Number(process.env.RENDER_NAV_TIMEOUT_MS ?? 20_000);

const FONT_CSS = readFileSync(path.join(FONTS_DIR, "fonts.css"), "utf8");
const MERMAID_JS = readFileSync(path.join(ASSETS_DIR, "mermaid.min.js"), "utf8");

/** One browser for the life of the process; a fresh context per request. */
let browserPromise = null;
function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return browserPromise;
}

/**
 * Replace every remote stylesheet with the bundled fonts.
 *
 * A designed page written against Google Fonts keeps working, and stops
 * depending on a network the exported file will not have.
 */
function inlineFonts(html) {
  const withoutRemote = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "");
  const style = `<style id="bundled-fonts">${FONT_CSS}</style>`;
  const head = /<head[^>]*>/i.exec(withoutRemote);
  if (head) {
    const at = head.index + head[0].length;
    return withoutRemote.slice(0, at) + style + withoutRemote.slice(at);
  }
  return style + withoutRemote;
}

/**
 * Everything executable, taken out.
 *
 * The portal sanitizes before it calls here, and this repeats the work on
 * purpose: a service does not trust its caller, and the bytes returned from this
 * function ARE the file a person downloads and opens from their disk, where
 * nothing the portal does can reach. Applied to the input so a page's own script
 * never runs in this pod, and to the output so the injected mermaid bundle does
 * not travel inside somebody's download.
 */
function stripExecutable(html) {
  return (
    html
      .replace(/<(script|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/?(script|iframe|object|embed|base)\b[^>]*>/gi, "")
      // `[\s/]`, not `\s`. A solidus is a valid attribute separator in HTML, so
      // `<svg/onload=...>` parses as a handler and a whitespace-only rule let it
      // straight through.
      .replace(/[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  );
}

/** HTML-escape for the one place a value is interpolated into markup by hand. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A markdown body wrapped into a printable page.
 *
 * Here rather than in the portal because Next.js refuses `react-dom/server`
 * anywhere in the App Router bundle, so the app cannot run its own React
 * markdown pipeline to a string. The stylesheet still arrives FROM the portal
 * (`lib/render/print-styles.ts`), so how an exported document looks stays owned
 * by the app and only the conversion happens here.
 *
 * A ```mermaid fence becomes `<pre class="mermaid">` so the diagram pass below
 * draws it, the same way the portal's on-screen renderer treats that fence.
 */
function markdownPage(markdown, title, css) {
  marked.setOptions({ gfm: true, breaks: false });
  const body = marked
    .parse(markdown ?? "")
    .replace(
      /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
      (_match, source) => `<pre class="mermaid">${source}</pre>`,
    );
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css ?? ""}</style>`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("\n");
}

async function renderPage(html, title) {
  const context = await (await browser()).newContext({
    viewport: { width: 1100, height: 1400 },
    // On, but only ever for OUR mermaid bundle: the document's own script tags
    // are stripped below before the page ever sees them. Off entirely is not an
    // option, because drawing a diagram needs a real browser running real code,
    // and that is the only reason this service exists.
    javaScriptEnabled: true,
  });
  // Nothing may leave this pod. The page has already had its fonts inlined, so a
  // request going out means the document asked for something it should not have,
  // and letting it through would make the render depend on the open internet.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("about:")) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  try {
    await page.setContent(inlineFonts(stripExecutable(html)), { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    // Chromium here runs with --no-sandbox, which is normal in a container and
    // is why nothing the document brought is allowed to execute. A page that
    // still manages to spin gets cut off rather than holding the single pod.
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    // Mermaid runs here rather than in the portal because this is the only place
    // with a real browser. A page with no mermaid fence pays nothing: the script
    // is only evaluated when one is present.
    const hasMermaid = await page.locator("pre.mermaid, .mermaid").count();
    if (hasMermaid > 0) {
      await page.addScriptTag({ content: MERMAID_JS });
      await page.evaluate(async () => {
         
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
         
        await window.mermaid.run({ querySelector: ".mermaid" });
      });
    }

    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    // The mutated DOM: fonts inlined, diagrams drawn. This is the `.html` a
    // person downloads, and it opens with no network. Stripped again on the way
    // out so the mermaid bundle we injected does not ship inside it.
    const rendered = stripExecutable(await page.content());
    return { pdf: pdf.toString("base64"), html: rendered, title };
  } finally {
    await context.close();
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return send(response, 200, { ok: true });
  }
  if (request.method !== "POST" || request.url !== "/render") {
    return send(response, 404, { error: "not found" });
  }

  try {
    const parsed = JSON.parse(await readBody(request));
    const title = typeof parsed.title === "string" ? parsed.title : "Document";
    // Two shapes: a designed page the assistant wrote, or a markdown body plus
    // the stylesheet the portal wants it printed with.
    const page =
      typeof parsed.html === "string" && parsed.html.trim() !== ""
        ? parsed.html
        : typeof parsed.markdown === "string" && parsed.markdown.trim() !== ""
          ? markdownPage(parsed.markdown, title, parsed.css)
          : "";
    if (page === "") return send(response, 400, { error: "html or markdown is required" });
    return send(response, 200, await renderPage(page, title));
  } catch (error) {
    console.error(`render failed: ${error && error.message}`);
    return send(response, 500, { error: "render failed" });
  }
});

server.listen(PORT, HOST, () => console.log(`doc-render listening on ${HOST}:${PORT}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      void (browserPromise ? browserPromise.then((b) => b.close()) : Promise.resolve()).finally(() => process.exit(0));
    });
  });
}
