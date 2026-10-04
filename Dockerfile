# syntax=docker/dockerfile:1
FROM node:22-slim AS builder
WORKDIR /app
# Pin pnpm to the version that produced pnpm-lock.yaml (matches packageManager in
# package.json), so --frozen-lockfile is reproducible and corepack never pulls an
# incompatible latest.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# better-sqlite3 (thread-ownership DB, lib/db/client.ts) installs a prebuilt
# native binary via prebuild-install when one matches this image's platform/Node
# ABI, and falls back to compiling with node-gyp otherwise — python3/make/g++
# cover that fallback so the image build never breaks on a missing prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN test -f portal.yaml || : > portal.yaml
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
RUN useradd -u 1001 -m appuser
# `lib/repo.ts`'s `refreshRepo()` spawns the `git` CLI directly (clone/fetch/
# reset) to keep the managed checkout at /data/repo fresh on every boot — this
# is the real-deploy half of the runtime-KB mechanism (it runs whenever
# REPO_READ_TOKEN is set, i.e. in both Helm envs). node:22-slim does not ship
# git, so without this the spawn always failed with ENOENT and /data/repo
# could never be populated on a fresh deploy — caught via a real docker build
# + run smoke test, not any unit test (none of them exec the real binary).
# ca-certificates is required alongside it: it's only a Recommends (not a
# Depends) of git, so --no-install-recommends silently drops it, and an HTTPS
# clone against the real GitLab remote fails TLS verification without it
# ("server certificate verification failed: CAfile: none") — also only
# visible by actually exercising the clone against a real HTTPS endpoint.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Persist the Claude Agent SDK's session transcripts across pod restarts.
#
# The SDK does NOT store sessions wherever `cwd`/the `dir` option to
# getSessionMessages() points (that value only feeds a sanitized "project key"
# subdirectory name) — it always resolves the actual storage ROOT to
# `CLAUDE_CONFIG_DIR`, falling back to `$HOME/.claude` when that's unset. uid
# 1001's HOME is ephemeral (and the docs KB clone lives at /data/repo, which
# instrumentation.ts `git reset --hard`s on every boot), so point this at a
# STABLE path on the same /data PVC — distinct from /data/repo (KB clone) and
# /data/portal.db (PORTAL_DB_PATH, set by the Helm env) so the three never
# collide. Created on first write by the PVC's writable-by-uid-1001 setup.
ENV CLAUDE_CONFIG_DIR=/data/claude
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/portal.yaml ./portal.yaml
USER 1001
EXPOSE 3100
# Next standalone server honours PORT/HOSTNAME env (set above).
CMD ["node", "server.js"]
