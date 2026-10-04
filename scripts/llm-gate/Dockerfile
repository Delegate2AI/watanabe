# llm-gate: personal LLM keys and token budgets in front of 9router.
#
# Runs as a sidecar in the 9router pod (helm/depends/9router.yaml) and reaches
# 9router on localhost. No dependencies: node:http, node:crypto and fetch.
# Tagged by the content of this directory, not by pipeline, so a push that does
# not touch the gate leaves the pod template (and 9router) alone.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8790

COPY match.mjs state.mjs usage.mjs server.mjs portal.mjs sync.mjs main.mjs ./

RUN useradd -u 1001 -m gate && chown -R gate:gate /app
USER gate

EXPOSE 8790
CMD ["node", "main.mjs"]
