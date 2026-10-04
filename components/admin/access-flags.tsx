"use client";

import { FLAG_REGISTRY, type FlagDescriptor } from "@/lib/config/flag-registry";

/**
 * The Flags tab.
 *
 * Two states used to be invisible here, and both meant a switch could be moved
 * with nothing happening:
 *
 * - A `restart`-effect flag whose saved override disagrees with the value the
 *   running process booted with. The switch flips, the deployment does not
 *   change, and nothing on the page says so. That is now a persistent "Pending
 *   restart" state naming who has to act.
 * - A flag whose `dependsOn` is off. Turning it on produces a stored override
 *   that no code path can honour. Such a flag is disabled with the dependency
 *   named, in the one direction that does nothing: turning it back OFF stays
 *   available, so a flag can never be trapped on.
 */

export interface FlagRuntimeState {
  /** The resolved value: the saved override when there is one, else the environment. */
  enabled: boolean;
  /** The value the running process booted with. */
  envEnabled: boolean;
}

const FLAG_LABELS = new Map(FLAG_REGISTRY.map(({ envVar, label }) => [envVar, label]));

function labelFor(envVar: string): string {
  return FLAG_LABELS.get(envVar) ?? envVar;
}

const chipClass = "rounded-full px-2.5 py-1 text-xs font-medium";

function FlagCard({
  flag,
  state,
  override,
  enabled,
  blockedBy,
  pending,
  onToggle,
}: {
  flag: FlagDescriptor;
  state: FlagRuntimeState;
  override: boolean | undefined;
  enabled: boolean;
  blockedBy: string | null;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  // Pending only against the booted environment value: that is what the running
  // deployment is actually doing, and a restart is the only thing that moves it.
  const pendingRestart = flag.effect === "restart" && override !== undefined && override !== state.envEnabled;
  const blocked = blockedBy !== null && !enabled;
  const overrideLabel = override === undefined ? "-" : override ? "on" : "off";

  return (
    <article className="grid gap-4 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink text-balance">{flag.label}</h3>
          {pendingRestart ? (
            <span className={`${chipClass} bg-amber-500/20 text-amber-700`} data-testid={`pending-${flag.envVar}`}>
              Pending restart
            </span>
          ) : flag.effect === "restart" ? (
            <span className={`${chipClass} bg-amber-500/15 text-amber-600`}>Restart required</span>
          ) : null}
          {blocked ? (
            <span className={`${chipClass} bg-surface-2 text-ink-muted`} data-testid={`blocked-${flag.envVar}`}>
              Unavailable
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted text-pretty">{flag.description}</p>
        <p className="mt-2 text-xs text-ink-faint">
          env: {state.envEnabled ? "on" : "off"}, override: {overrideLabel}
          {flag.dependsOn ? `, requires ${labelFor(flag.dependsOn)}` : ""}
        </p>
        {pendingRestart ? (
          <p className="mt-2 text-xs text-amber-600 text-pretty">
            Saved as {override ? "on" : "off"}, and the running deployment is still{" "}
            {state.envEnabled ? "on" : "off"}. An operator has to restart the deployment before this takes effect.
          </p>
        ) : null}
        {blocked ? (
          <p className="mt-2 text-xs text-ink-muted text-pretty" data-testid={`reason-${flag.envVar}`}>
            Requires {labelFor(blockedBy)}. Turn that on first, otherwise this does nothing.
          </p>
        ) : null}
        {flag.envVar === "ROLES_ENABLED" ? (
          <p className="mt-2 text-xs text-amber-600 text-pretty">
            Turning roles off can remove access administration from admins who are not bootstrap admins.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${flag.label}`}
        disabled={pending || blocked}
        onClick={() => onToggle(!enabled)}
        className="flex min-h-10 min-w-12 items-center justify-center rounded-lg transition-transform duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-[background-color] duration-150 ease-out ${enabled ? "bg-accent" : "bg-line"}`}>
          <span className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${enabled ? "translate-x-5" : "translate-x-0"}`} />
        </span>
      </button>
    </article>
  );
}

export function AccessFlags({
  flagStates,
  overrides,
  pending,
  onToggle,
}: {
  flagStates: Record<string, FlagRuntimeState>;
  /** Saved overrides, with any not-yet-refreshed local toggle merged over them. */
  overrides: Partial<Record<string, boolean>>;
  pending: boolean;
  onToggle: (envVar: string, next: boolean) => void;
}) {
  function resolved(envVar: string): boolean {
    return overrides[envVar] ?? flagStates[envVar]?.enabled ?? false;
  }

  return (
    <section className="space-y-3">
      {FLAG_REGISTRY.map((flag) => (
        <FlagCard
          key={flag.envVar}
          flag={flag}
          state={flagStates[flag.envVar] ?? { enabled: false, envEnabled: false }}
          override={overrides[flag.envVar]}
          enabled={resolved(flag.envVar)}
          blockedBy={flag.dependsOn && !resolved(flag.dependsOn) ? flag.dependsOn : null}
          pending={pending}
          onToggle={(next) => onToggle(flag.envVar, next)}
        />
      ))}
    </section>
  );
}
