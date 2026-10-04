import { NextResponse } from "next/server";

// Liveness/readiness probe. Deliberately imports nothing stateful (no DB client,
// no env validation module): the pod must report healthy even before the rest of
// the app exists or is mid-outage.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
