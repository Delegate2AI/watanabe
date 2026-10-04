"use client";

import { useRef } from "react";
import { Settings, Check, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { modelAllowlist, DEFAULT_EFFORT } from "@/lib/agent/model-options";

/** The oauth2-proxy sign-out endpoint; overridable for other auth deployments. */
const SIGN_OUT_HREF = process.env.NEXT_PUBLIC_SIGN_OUT_URL || "/oauth2/sign_out";

const THEMES: { value: string; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The top-right settings dropdown (spec 24), replacing spec 18's disabled stub.
 * It carries the three shell settings the spec calls for: theme (light / dark /
 * system, wired to next-themes), the default model and reasoning level (shown
 * from the env-configured allowlist), and a sign-out control. Kept a pure menu
 * so it renders in tests without extra providers beyond the theme context the
 * shell already supplies.
 */
export function SettingsMenu({
  name,
  oidcSignOut = false,
  modelSwitchingEnabled = false,
}: {
  name: string;
  /**
   * In `auth.mode: oidc` the portal owns the session, so signing out is a POST
   * to its own route rather than a link to the proxy's endpoint. POST so a
   * cross-site image tag cannot sign someone out.
   */
  oidcSignOut?: boolean;
  /**
   * Whether this deployment configured a model allowlist
   * (`isModelSwitchingEnabled()`, resolved on the server). Server env is never
   * read here: reading it client-side always yields `undefined`, which is how
   * the caption came to promise a per-chat switch on a deployment that has
   * none.
   */
  modelSwitchingEnabled?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const defaultModel = modelAllowlist()[0]?.label ?? "Default";
  const signOutForm = useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Settings"
        aria-label="Settings"
        className="grid size-[34px] place-items-center rounded-full border border-line bg-surface text-ink-muted shadow-card hover:text-ink"
      >
        <Settings className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Theme
        </DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onSelect={() => setTheme(t.value)}
            className="flex items-center gap-2"
          >
            <Check className={theme === t.value ? "size-3.5 text-accent" : "size-3.5 invisible"} />
            {t.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Default model
        </DropdownMenuLabel>
        {/* This is read-only information, not a control: it shows the model this
            deployment starts a chat on. Rendered as a plain row (not a disabled
            menu item, which read as a broken setting), with a caption pointing
            to where the model IS changeable, per conversation in the composer. */}
        <div className="flex justify-between px-2 py-1.5 text-sm text-ink-muted">
          <span>{defaultModel}</span>
          <span className="text-accent-ink">{titleCase(DEFAULT_EFFORT)}</span>
        </div>
        {/* Only promise the per-chat switch where it actually exists. This line
            used to say it unconditionally, so on a deployment with no model
            allowlist configured it pointed at a composer chip that is inert by
            design, and the reader concluded the control was broken. */}
        <p className="px-2 pb-1.5 text-[11px] leading-snug text-ink-faint">
          {modelSwitchingEnabled
            ? "Set by this workspace. Switch models for a single chat from the composer."
            : "Set by this workspace. This deployment offers no other model to switch to."}
        </p>
        <DropdownMenuSeparator />
        {oidcSignOut ? (
          <>
            {/* Radix's item keydown handler calls event.currentTarget.click(),
                and HTMLFormElement.click() has no activation behavior, so
                wrapping a <form> in `asChild` leaves Enter and Space dead.
                requestSubmit() on select fires the same submit synchronously,
                before Radix unmounts the menu on close, which also removes an
                unmount race the previous mouse-click path had. */}
            <DropdownMenuItem
              className="flex items-center gap-2"
              onSelect={(event) => {
                event.preventDefault();
                signOutForm.current?.requestSubmit();
              }}
            >
              <LogOut className="size-3.5" />
              Sign out
            </DropdownMenuItem>
            <form ref={signOutForm} method="post" action="/api/auth/logout" hidden />
          </>
        ) : (
          <DropdownMenuItem asChild>
            <a href={SIGN_OUT_HREF} className="flex items-center gap-2">
              <LogOut className="size-3.5" />
              Sign out
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
