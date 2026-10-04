import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";
import { safeReturnPath } from "@/lib/auth/oidc/return-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The sign-in screen for `auth.mode: oidc`.
 *
 * Deliberately outside the `(app)` route group: the shell layout resolves
 * identity and redirects here when there is none, so a login page inside it
 * would redirect to itself. 404 in every other mode, where something upstream
 * owns the login.
 *
 * Error codes arrive in the query string, so they are attacker-controlled. They
 * are looked up in a table and never rendered, which is why an unknown code
 * yields generic copy rather than an echo of whatever was in the URL.
 */

const ERROR_COPY: Record<string, string> = {
  missing_params: "That sign-in link was incomplete. Try again.",
  state_mismatch: "That sign-in attempt could not be verified. Try again.",
  exchange_failed: "Your identity provider did not complete the sign-in. Try again.",
  token_invalid: "Your identity provider's response could not be verified.",
  not_allowed: "That account is not allowed to use this portal.",
  provider_unreachable: "Your identity provider could not be reached. Try again shortly.",
};

const GENERIC_ERROR = "Sign-in could not be completed. Try again.";

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  logto: "Logto",
  generic: "your identity provider",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { auth, app } = getConfig();
  if (auth.mode !== "oidc") notFound();

  const params = await searchParams;
  // Next's actual runtime type for a repeated query parameter is `string[]`,
  // not the single `string` this route only ever sets itself: `/login?next=/a&next=/b`
  // would otherwise reach `raw.startsWith` inside `safeReturnPath` with an
  // array. Take the first occurrence of each, so a crafted repeated parameter
  // degrades to "treat it as one value" rather than a thrown TypeError on the
  // public, unauthenticated sign-in page.
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  // `Object.hasOwn`, not a plain lookup with `??`. `ERROR_COPY` is an object
  // literal, so `?error=constructor` would return an inherited function and
  // `?error=__proto__` an object, and React renders the first as blank and
  // throws on the second. The query string is attacker-controlled, so the
  // sign-in page would be the one thing a crafted link could break.
  const message = error
    ? Object.hasOwn(ERROR_COPY, error)
      ? (ERROR_COPY[error] as string)
      : GENERIC_ERROR
    : null;

  const destination = safeReturnPath(next);
  const href =
    destination === "/" ? "/api/auth/login" : `/api/auth/login?next=${encodeURIComponent(destination)}`;

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-card">
        <h1 className="text-lg font-semibold text-[var(--color-ink-strong)]">{app.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Sign in to continue.</p>

        {message ? (
          <p role="alert" className="mt-4 rounded-lg border border-line bg-[var(--background)] p-3 text-sm">
            {message}
          </p>
        ) : null}

        <a
          href={href}
          className="mt-6 flex h-10 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-white"
        >
          Continue with {PROVIDER_LABEL[auth.oidc.provider] ?? "your identity provider"}
        </a>
      </div>
    </main>
  );
}
