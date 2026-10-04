# The document render sidecar: markup in, a PDF and a self-contained page out.
#
# Its own image, and its own Deployment applied out of band from the Helm release
# (helm/depends/doc-render.yaml), for the reason the whisper sidecar has one: a
# headless Chromium is roughly 450MB of browser and system libraries, and the
# portal image should not carry it.
#
# The fonts and the mermaid bundle are baked in at build time. Nothing is fetched
# at render time, which is what makes an exported file open with no network and a
# PDF come out the same on every run.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    FONTS_DIR=/opt/fonts \
    ASSETS_DIR=/opt/assets

# `--with-deps` pulls the system libraries Chromium needs on Debian. Pinned
# versions so a rebuild of an old commit produces the same browser.
RUN npm install --no-save playwright@1.49.1 mermaid@11.4.1 marked@15.0.6 \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# One file, so the server can read it without a bundler.
RUN mkdir -p /opt/assets \
 && cp node_modules/mermaid/dist/mermaid.min.js /opt/assets/mermaid.min.js

# Needs network, which the CI builder has. A failure here fails the build rather
# than producing an image that silently falls back to a system font.
COPY fetch-fonts.mjs ./
RUN node fetch-fonts.mjs /opt/fonts

COPY server.mjs ./

RUN useradd -u 1001 -m renderer \
 && chown -R renderer:renderer /app /opt/fonts /opt/assets \
 && chmod -R a+rX /opt/playwright
USER renderer

ENV RENDER_HOST=0.0.0.0 \
    RENDER_PORT=8791
EXPOSE 8791

CMD ["node", "server.mjs"]
