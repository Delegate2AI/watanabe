"use client";

import { toast } from "sonner";

/**
 * The one place the app raises a toast.
 *
 * Two reasons this is a module and not a direct `toast(...)` call at every call
 * site. First, every emission is wrapped: a toast is a report ABOUT a mutation,
 * so it must never throw into the mutation it reports on. If the toaster is not
 * mounted, or the library changes shape, the change still lands and the user
 * simply gets no confirmation. Second, it keeps the copy path narrow: failure
 * copy arrives already mapped through `lib/errors/messages.ts`, so no call site
 * is tempted to pass a raw server string.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Confirm a mutation that landed, optionally offering a one-call reversal. */
export function notifySuccess(message: string, action?: ToastAction): void {
  try {
    toast.success(message, action ? { action } : undefined);
  } catch {
    // A missing toaster must not turn a successful mutation into a failure.
  }
}

/**
 * Report a mutation that failed. `message` must already be user-facing copy from
 * `messageFor(code)`: never hand this function a raw response body.
 */
export function notifyFailure(message: string): void {
  try {
    toast.error(message);
  } catch {
    // Same contract: reporting a failure must not raise a second one.
  }
}
