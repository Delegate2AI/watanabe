import { inputClass } from "./access-ui";

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-faint";
const areaClass = "min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent";

export const AUTH_MODES = ["none", "oauth"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export function ConnectorOauthFields({
  auth,
  oauthClientId,
  oauthClientSecret,
  authOrigins,
  onAuthChange,
  onClientIdChange,
  onClientSecretChange,
  onAuthOriginsChange,
}: {
  auth: AuthMode;
  oauthClientId: string;
  oauthClientSecret: string;
  authOrigins: string;
  onAuthChange: (value: AuthMode) => void;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onAuthOriginsChange: (value: string) => void;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className={labelClass}>Authorization</legend>
      <div className="flex gap-4 pt-1">
        {AUTH_MODES.map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm text-ink">
            <input type="radio" name="auth" value={option} checked={auth === option} onChange={() => onAuthChange(option)} />
            {option}
          </label>
        ))}
      </div>
      {auth === "oauth" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className={labelClass}>OAuth client ID</span>
            <input value={oauthClientId} onChange={(e) => onClientIdChange(e.target.value)} className={inputClass} placeholder="the-client-id" />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>OAuth client secret</span>
            <input value={oauthClientSecret} onChange={(e) => onClientSecretChange(e.target.value)} className={inputClass} placeholder="${EXAMPLE_OAUTH_SECRET}" />
            <span className="text-xs text-ink-faint">A {"${VAR}"} reference only. Never returned by the API, so re-enter it on every edit.</span>
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className={labelClass}>Authorization origins</span>
            <textarea value={authOrigins} onChange={(e) => onAuthOriginsChange(e.target.value)} className={areaClass} placeholder="https://auth.example.com" />
            <span className="text-xs text-ink-faint">One exact https origin per line, for an authorization server that is not same-origin.</span>
          </label>
        </div>
      )}
    </fieldset>
  );
}
