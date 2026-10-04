"use client";

import { Toaster as ThemedToaster } from "@/components/ui/sonner";

/**
 * The app shell's single toast surface.
 *
 * Mounted once in `app/(app)/layout.tsx` so every mutation anywhere under the
 * shell has somewhere to confirm itself. `components/ui/sonner.tsx` already maps
 * the library's internals onto the design tokens and follows the active theme;
 * this wrapper only fixes the app-level placement and timing, so those choices
 * live in one place instead of at each call site.
 *
 * Bottom right, out of the way of the sticky composer that owns the bottom
 * centre of the chat surface. Six seconds is long enough to read a confirmation
 * and reach an Undo without the toast becoming furniture. The close button
 * matters for the Undo case: a toast the user has finished with should be
 * dismissable rather than merely waited out.
 */
export function Toaster() {
  return <ThemedToaster position="bottom-right" duration={6000} closeButton />;
}
