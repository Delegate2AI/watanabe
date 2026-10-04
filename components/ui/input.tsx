import * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input, token-swapped to the spec 18 surface/line/ink palette. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-control border border-line bg-surface px-3 py-1 text-sm text-ink shadow-card transition-colors",
        "placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
