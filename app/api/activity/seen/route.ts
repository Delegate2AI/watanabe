// The activity bell POSTs here to advance the caller's last-seen cursor. The
// handler is defined in the parent route module (it shares the identity + flag
// gating); this nested route is the URL the client actually calls, so it must
// exist as its own segment. Without it the POST 404s and the cursor never moves.
export { POST } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
