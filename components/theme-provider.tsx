"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * App-wide light/dark theming for the spec 18 shell.
 *
 * `attribute="data-theme"` writes the chosen theme to `<html data-theme>`, which
 * the token stylesheet (`app/design-tokens.css`) uses to override
 * `prefers-color-scheme` in both directions. `defaultTheme="system"` means an
 * untouched visitor follows their OS setting; `enableSystem` keeps that live.
 * `disableTransitionOnChange` prevents a color-transition flash when toggling.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
