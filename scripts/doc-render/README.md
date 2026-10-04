# doc-render

The document render sidecar: markup in, a PDF and a self-contained page out.

Spec: `docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md`

## Why it is a separate service

A headless Chromium is roughly 450MB of browser and system libraries. Putting it
in the portal image would multiply the size of every deploy for a feature that
runs on a fraction of requests, so it gets its own image and its own Deployment,
applied out of band from the Helm release exactly as the PVC is.

It is deliberately dumb. It holds no state, reads no database, has no notion of
who a user is, and is reachable only in-cluster through its ClusterIP service.
The portal is the only client and the only thing it can ask for is "draw this".

## What it does to a page

1. Drops every remote stylesheet link and inlines the bundled fonts.
2. Renders any `<pre class="mermaid">` block to inline SVG.
3. Prints to PDF, and returns the mutated DOM as the `.html`.

Every outbound request from the page is aborted. Once the fonts are inlined
nothing legitimate needs the network, so a request going out means the document
asked for something it should not have, and allowing it would make the render
depend on the open internet.

## API

```
GET  /health  -> {"ok": true}
POST /render  -> {"html": "<!doctype html>...", "title": "Quarterly review"}
              <- {"pdf": "<base64>", "html": "<rendered>", "title": "..."}
```

## Fonts

`fetch-fonts.mjs` runs at image build and bakes in Fraunces, Source Serif 4,
JetBrains Mono and Inter as base64 woff2. That build step needs network, which
the CI builder has; a failure fails the build rather than producing an image that
silently falls back to a system font.

The list is fixed. Adding a family means rebuilding this image, which is the
price of an exported file that opens offline and a PDF that is identical on every
run. `lib/agent/design-prompt.ts` names the same four so the assistant only
reaches for what is actually here.

## Local

```sh
cd scripts/doc-render
docker build -t doc-render .
docker run --rm -p 8791:8791 doc-render
```

Then point the portal at it:

```sh
DOC_RENDER_URL=http://localhost:8791
```

Without `DOC_RENDER_URL` the portal still saves documents, still renders them in
the canvas, and still exports Markdown. What is unavailable is PDF and HTML,
which answer 503.
