import { createPortalClient } from "./portal.mjs";
import { createGateServer } from "./server.mjs";
import { GateState } from "./state.mjs";
import { createSync } from "./sync.mjs";

const PULL_MS = 30_000;
const FLUSH_MS = 5_000;

const env = (name, fallback = null) => process.env[name]?.trim() || fallback;
const port = Number(env("PORT", "8790"));
const routerUrl = env("ROUTER_URL", "http://127.0.0.1:20128");
const portalUrl = env("PORTAL_URL", "http://watanabe:3100");
const secret = env("LLM_GATE_SECRET");
const helpUrl = env("HELP_URL");

const state = new GateState();
const sync = secret ? createSync({ state, portal: createPortalClient({ portalUrl, secret }) }) : null;

// Without the secret the gate cannot reach the portal, so it never gets a
// snapshot and answers 503 to everything. It still serves /healthz: a sidecar
// that fails its probe would take 9router down with it.
if (!sync) console.error("llm-gate: LLM_GATE_SECRET is unset; refusing all requests until it is set");

const server = createGateServer({
  state,
  routerUrl,
  secret,
  helpUrl,
  onInvalidate: () => void sync?.pull(),
});

server.listen(port, "0.0.0.0", () => console.log(`llm-gate listening on ${port}, router ${routerUrl}`));

if (sync) {
  void sync.pull();
  setInterval(() => void sync.pull(), PULL_MS).unref();
  setInterval(() => void sync.flush(), FLUSH_MS).unref();
}

/** Under the pod's 30s grace period: long enough for most in-flight replies to finish and be counted. */
const DRAIN_STREAMS_MS = 20_000;

async function shutdown(signal) {
  console.log(`llm-gate: ${signal}, waiting for open requests, then flushing usage`);
  const closed = new Promise((resolve) => server.close(resolve));
  const timedOut = new Promise((resolve) => setTimeout(resolve, DRAIN_STREAMS_MS).unref());
  await Promise.race([closed, timedOut]);
  await sync?.drain();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
