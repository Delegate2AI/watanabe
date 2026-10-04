# llm-gate

Personal LLM keys and token budgets in front of 9router. Spec: `docs/superpowers/specs/2026-10-03-llm-keys-9router-design.md`. Plan: `docs/superpowers/plans/2026-10-04-llm-keys-b-gate-sidecar.md`.

It runs as a second container in the 9router pod. Harnesses call `https://llm-<project>.<domain>/v1/...` with their personal key. The gate checks the key, the model's group and the remaining budget from the portal's snapshot, then streams the request to 9router on `127.0.0.1:20128` with the key unchanged and counts the tokens in the reply.

| Env | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8790` | Listen port |
| `ROUTER_URL` | `http://127.0.0.1:20128` | 9router, same pod |
| `PORTAL_URL` | `http://watanabe:3100` | Portal, in cluster |
| `LLM_GATE_SECRET` | none | Shared with the portal. Unset: every request gets 503 |
| `HELP_URL` | none | Shown in 403 and 429 messages |

State is in memory: the snapshot (pulled every 30s and on `POST /invalidate`) and usage not yet confirmed by the portal (pushed every 5s and on shutdown). One replica, because 9router is one replica. `/healthz` answers from the process alone, never from the snapshot, so a portal outage cannot take 9router out of its Service.

## Tests

`pnpm vitest run scripts/llm-gate` from the repo root.

## Contract check before bumping 9router

The portal drives 9router's undocumented dashboard API. Before changing the 9router image tag, start the new image and run the contract check against it:

```bash
docker run --rm -d -p 20128:20128 -e INITIAL_PASSWORD=contract -e JWT_SECRET=x -e API_KEY_SECRET=y --name 9r decolua/9router:<tag>
ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=contract node scripts/llm-gate/contract.mjs
docker rm -f 9r
```
