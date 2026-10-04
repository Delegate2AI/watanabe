import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { IdentityProvider } from "@/components/identity-provider";
import type { ShellIdentity } from "@/lib/identity/stub";
import { Sidebar } from "@/components/shell/sidebar";
import { MainFrame } from "@/components/shell/main-frame";
import { Toaster } from "@/components/toaster";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { resolveIdentity } from "@/lib/identity/resolve";
import { getConfig, getPublicConfig } from "@/lib/config";
import { getGitHost } from "@/lib/git-host";
import { AppConfigProvider } from "@/components/app-config-provider";
import { isActivityEnabled } from "@/lib/activity/config";
import { isTasksEnabled } from "@/lib/tasks/config";
import { can } from "@/lib/authority/roles";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { isSkillsEnabled } from "@/lib/skills/config";
import { authorGroups } from "@/lib/skills/authors";
import { isModelSwitchingEnabled } from "@/lib/agent/model-options";
import { getDb } from "@/lib/db/client";
import { getForRequester } from "@/lib/db/tasks";
import { requesterKey } from "@/lib/db/tasks-visibility";
import { needsMyTriage } from "@/lib/tasks/scope";
import { threadSummaries, type ThreadSummary } from "@/lib/threads/summaries";
import { viewerName } from "@/lib/people/resolve";
import { isPeopleActivityEnabled } from "@/lib/people/config";
import { isKbReviewEnabled } from "@/lib/review/config";
import { isUsageAuditEnabled } from "@/lib/usage/config";
import { isLlmKeysEnabled } from "@/lib/llm/config";
import { analyticsIdFor, isAnalyticsEnabled, posthogHost, posthogKey } from "@/lib/analytics/config";

/**
 * Shell layout for the spec 18 app surface. A two-column, SINGLE-ROW grid
 * (264px sidebar + flexible main) filling the viewport, with the body
 * non-scrolling and the main Stage owning vertical scroll. Under 860px the grid
 * collapses to one column and the sidebar becomes an off-canvas drawer (see
 * Sidebar). The single row is explicit; see the `grid-rows-1` note below.
 *
 * Identity is resolved server-side here via the real resolver (proxy-header /
 * groups) and handed to IdentityProvider so every shell surface reads
 * clearance/name from one context. The authority SUBSYSTEM stays gated
 * (clearance degrades to ["all-hands"] when AUTHORITY_ENABLED is off, and role
 * is present only when ROLES_ENABLED is on), but the shell reflects the actual
 * request identity. A request with no identity fails CLOSED: a redirect to
 * /login in oidc mode, notFound() otherwise. Never a fabricated fallback. Kept
 * a server component so per-route RSC data fetching is unaffected; theme +
 * identity consumers are client islands nested below.
 *
 * Two feature flags are resolved HERE (server) and threaded down as booleans /
 * counts so no client island imports a server config value: the activity bell
 * (ACTIVITY_ENABLED) and the Tasks sidebar badge (TASKS_ENABLED). The Access
 * admin nav entry is resolved the same way via `can(email, "manageAccess")`,
 * matching the `/admin/access` page's own gate exactly.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const resolved = await resolveIdentity(await headers());
  if (!resolved) {
    // In oidc mode the portal owns the login, so an unauthenticated page load
    // is someone who needs to sign in, not a 404. Every other mode keeps
    // failing closed exactly as before: something upstream should have
    // established identity, and its absence is a misconfiguration, not an
    // invitation to a sign-in screen this deployment does not have.
    //
    // No `next` parameter: a server layout has no reliable read of the current
    // pathname in the App Router, and the alternatives (a middleware stamping a
    // header) cost more than returning someone to the page they were on.
    if (getConfig().auth.mode === "oidc") redirect("/login");
    notFound();
  }

  // The display name and its initials are resolved HERE because the resolver
  // reads the directory from disk and the avatar lives in a client island. With
  // PEOPLE_ENABLED off both fall back to exactly what the shell showed before
  // the directory existed: the email local part, and its first letter.
  const { name, initials } = viewerName(resolved.email, resolved.name);
  const identity: ShellIdentity = {
    email: resolved.email,
    name,
    initials,
    clearance: resolved.clearance,
    ...(resolved.role ? { role: resolved.role } : {}),
  };

  const activityEnabled = isActivityEnabled();
  const analyticsKey = isAnalyticsEnabled() ? posthogKey() : null;
  const analyticsHost = analyticsKey ? posthogHost() : null;
  // In oidc mode the portal owns the session, so the settings menu's sign-out
  // control posts to its own logout route rather than linking to the
  // oauth2-proxy endpoint. See components/shell/settings-menu.tsx.
  const oidcSignOut = getConfig().auth.mode === "oidc";
  const tasksCount = resolveTasksBadge(identity);
  const showAdmin = can(identity.email, "manageAccess");
  // Spec 33: the same capability AND the subsystem flag, matching the
  // /admin/connectors page's own two gates, so flag-off shows no link.
  const showConnectors = showAdmin && isConnectorsEnabled();
  // Spec 34: the same shape again, matching the /admin/skills page's own gates.
  const showSkills = showAdmin && isSkillsEnabled();
  // And again for /admin/design, the house style for designed documents.
  const showDesign = showAdmin && isHtmlDocumentsEnabled();
  const showUsage = showAdmin && isUsageAuditEnabled();
  // Personal LLM keys: the user page needs only the flag; budgets need the capability too.
  const showLlmKeys = isLlmKeysEnabled();
  const showLlmAdmin = showAdmin && showLlmKeys;
  // No capability: the MCP settings page grants nothing by existing.
  const showMcp = isMcpEnabled();
  // The people activity dashboard is the flag ALONE, deliberately: the surface
  // only rearranges the meetings and tasks this viewer is already cleared to
  // see, so gating it on a capability would hide shared context, not protect
  // anything. Flag off, no entry renders and the nav is byte-identical.
  const showPeople = isPeopleActivityEnabled();
  // The review queue's own two gates, so an entry never links to a page that
  // 404s: the flag AND the capability that lets a viewer merge a proposal.
  const showReview = isKbReviewEnabled() && can(identity.email, "approve");
  const showConnectorsDirectory = isConnectorsEnabled();
  const showSkillStudio =
    isSkillsEnabled() && (authorGroups(identity.email).length > 0 || showAdmin);

  return (
    <ThemeProvider>
      <IdentityProvider identity={identity}>
        <AppConfigProvider config={{ ...getPublicConfig(), terms: getGitHost().terms }}>
        {/* Off, the island is not rendered at all, so no analytics code reaches
            the client. The id is hashed here: the browser never holds an
            address for this purpose. */}
        {analyticsKey && analyticsHost ? (
          <AnalyticsProvider
            apiKey={analyticsKey}
            distinctId={analyticsIdFor(identity.email)}
            host={analyticsHost}
          />
        ) : null}
        {/* `grid-rows-1` is load-bearing, not decoration. Sonner's <Toaster />
            always renders a static <section> wrapper (its toast <ol> is the
            part that goes `position: fixed`), so that section is a real in-flow
            grid item and auto-places into a SECOND row. With the row track left
            implicit, both rows size to `auto` and `align-content: normal`
            (stretch) then splits the leftover viewport height evenly between
            them, so the sidebar and main frame only ever got a fraction of the
            height and the shell's own `bg-bg` showed through below them.
            Pinning the track to a single `minmax(0, 1fr)` row gives the two
            columns the full height and leaves the toast surface a zero-height
            implicit row. Only visible when the viewport is taller than the
            sidebar's intrinsic content, which is why a short window looked fine. */}
        <div className="app-shell grid h-screen grid-cols-[264px_1fr] grid-rows-1 overflow-hidden bg-bg text-ink [font-family:var(--sans)] max-[860px]:grid-cols-1">
          <Sidebar
            tasksCount={tasksCount}
            showAdmin={showAdmin}
            showConnectors={showConnectors}
            showConnectorsDirectory={showConnectorsDirectory}
            showSkills={showSkills}
            showSkillStudio={showSkillStudio}
            showDesign={showDesign}
            showUsage={showUsage}
            showLlmKeys={showLlmKeys}
            showLlmAdmin={showLlmAdmin}
            showMcp={showMcp}
            showPeople={showPeople}
            showReview={showReview}
            threads={resolveSidebarThreads(identity)}
          />
          <MainFrame
            activityEnabled={activityEnabled}
            feedbackHref={getConfig().app.feedbackUrl}
            oidcSignOut={oidcSignOut}
            modelSwitchingEnabled={isModelSwitchingEnabled()}
          >
            {children}
          </MainFrame>
          {/* One toast surface for the whole shell: every mutation under it
              confirms here rather than changing the screen silently. Kept INSIDE
              `.app-shell` on purpose: the accent focus ring and the
              reduced-motion rule in design-tokens.css are both scoped to
              `.app-shell` descendants, and sonner renders toasts in place rather
              than portaling them to <body>. */}
          <Toaster />
        </div>
        </AppConfigProvider>
      </IdentityProvider>
    </ThemeProvider>
  );
}

/**
 * The sidebar's Pinned + Recents list, read here rather than fetched by the
 * sidebar after hydration. It is the same owner-scoped query `GET /api/threads`
 * runs, against a synchronous local database, during a request that is already
 * touching that database for the tasks badge: paying for it here costs the page
 * nothing and saves every load a round trip plus a stretch of placeholder rows.
 *
 * Degrades to `undefined` on any read error, which is the sidebar's signal to
 * fall back to fetching for itself. A thread-store hiccup must not take out the
 * whole shell.
 */
function resolveSidebarThreads(identity: ShellIdentity): ThreadSummary[] | undefined {
  try {
    return threadSummaries(getDb(), identity.email);
  } catch {
    return undefined;
  }
}

/**
 * The Tasks sidebar badge: the number of PROPOSED tasks awaiting this
 * requester's decision. `getForRequester` answers who may SEE a proposal;
 * `needsMyTriage` is the narrower question of whose queue it is, and the Inbox
 * strip on /tasks reads the same predicate, so the badge and the strip cannot
 * name different numbers.
 * or `undefined` (no badge) when TASKS_ENABLED is off or nothing is pending.
 * Degrades to no badge on any read error so a task-store hiccup never breaks the
 * shell chrome.
 */
function resolveTasksBadge(identity: ShellIdentity): number | undefined {
  if (!isTasksEnabled()) return undefined;
  try {
    const actorEmail = requesterKey(identity.email);
    const proposed = getForRequester(
      getDb(),
      identity.email,
      identity.clearance,
      ["proposed"],
    ).filter((task) => needsMyTriage(task, actorEmail));
    return proposed.length > 0 ? proposed.length : undefined;
  } catch {
    return undefined;
  }
}
