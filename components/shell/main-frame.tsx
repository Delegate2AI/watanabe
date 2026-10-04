import type { ReactNode } from "react";
import { IdentityCluster } from "./identity-cluster";

/**
 * The main region of the shell (spec 18): a relative frame carrying the
 * floating identity cluster, with a `Stage` that owns vertical scroll while the
 * document body stays fixed. Route content renders inside the Stage.
 *
 * `activityEnabled` is resolved server-side in the layout and threaded through
 * to the identity cluster's activity bell, so no client island reads the flag.
 * `feedbackHref` (`portal.yaml`'s `app.feedbackUrl`) and `oidcSignOut`
 * (`auth.mode === "oidc"`) travel the same way: the config module is
 * `server-only`, so a client island cannot read either directly.
 */
export function MainFrame({
  children,
  activityEnabled = false,
  feedbackHref,
  oidcSignOut = false,
  modelSwitchingEnabled = false,
}: {
  children: ReactNode;
  activityEnabled?: boolean;
  feedbackHref?: string;
  oidcSignOut?: boolean;
  /** `isModelSwitchingEnabled()`. See `SettingsMenu`'s own prop doc. */
  modelSwitchingEnabled?: boolean;
}) {
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden">
      <IdentityCluster
        activityEnabled={activityEnabled}
        feedbackHref={feedbackHref}
        oidcSignOut={oidcSignOut}
        modelSwitchingEnabled={modelSwitchingEnabled}
      />
      <Stage>{children}</Stage>
    </div>
  );
}

/** The scrollable content region. Split out so surfaces can reference it. */
export function Stage({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
}
