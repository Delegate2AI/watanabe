"use client";

import { useIdentity } from "@/components/identity-provider";
import { ClearanceBadge } from "@/components/kit/clearance-badge";
import { Activity } from "./activity";
import { HelpDialog } from "./help-dialog";
import { SettingsMenu } from "./settings-menu";

/**
 * The floating top-right identity cluster (spec 18/24): the activity bell,
 * clearance badge, help and settings controls, and the avatar with the user's
 * name. This deliberately REPLACES Claude Desktop's bottom-left account block
 * (per the redlines). The help and settings controls are wired here (spec 24):
 * help opens an about/feedback dialog, settings carries theme, default
 * model/level, and sign-out.
 *
 * `activityEnabled` (ACTIVITY_ENABLED) is resolved server-side and passed down;
 * when off, the bell renders nothing so the header is byte-identical to today.
 * `oidcSignOut` travels the same way: it decides whether the settings menu's
 * sign-out control posts to the portal's own logout route or keeps linking to
 * the oauth2-proxy endpoint.
 */
export function IdentityCluster({
  activityEnabled = false,
  feedbackHref,
  oidcSignOut = false,
  modelSwitchingEnabled = false,
}: {
  activityEnabled?: boolean;
  /** `portal.yaml`'s `app.feedbackUrl`. Absent hides the feedback link. */
  feedbackHref?: string;
  /** `getConfig().auth.mode === "oidc"`. See `SettingsMenu`'s own prop doc. */
  oidcSignOut?: boolean;
  /** `isModelSwitchingEnabled()`. See `SettingsMenu`'s own prop doc. */
  modelSwitchingEnabled?: boolean;
}) {
  const { name, initials } = useIdentity();

  return (
    <div className="absolute right-4 top-3 z-10 flex items-center gap-2.5">
      <Activity enabled={activityEnabled} />
      <ClearanceBadge />
      <HelpDialog feedbackHref={feedbackHref} />
      <SettingsMenu name={name} oidcSignOut={oidcSignOut} modelSwitchingEnabled={modelSwitchingEnabled} />
      <span className="flex items-center gap-2 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-3 text-[13px] font-medium shadow-card">
        <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-bold text-white">
          {initials}
        </span>
        {name}
      </span>
    </div>
  );
}
