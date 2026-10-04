"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

const noop = () => () => {};

/**
 * Returns false during SSR and the first client render, true once hydrated.
 * Implemented with useSyncExternalStore (server snapshot vs client snapshot)
 * rather than a `setState`-in-effect, which the repo's react-hooks lint blocks.
 */
function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * The sidebar footer theme toggle (spec 18). Flips between light and dark,
 * resolving "system" to whichever the OS currently shows so the first click
 * always visibly changes the theme. Shows a stable icon until hydrated to avoid
 * a mismatch (next-themes only knows the resolved theme client-side).
 */
export function AppearanceToggle() {
  const hydrated = useHydrated();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title="Toggle theme"
      aria-label="Toggle theme"
      className="grid size-7 place-items-center rounded-icon text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      {hydrated && isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}
