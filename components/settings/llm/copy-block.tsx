"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { notifyFailure } from "@/lib/ui/toast";

/** A block of text with a copy button, for keys and setup snippets. */
export function CopyBlock({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => notifyFailure("Could not copy. Select the text and copy it instead."));
  }

  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1 py-0.5 text-xs text-ink">{value}</pre>
      <button
        type="button"
        onClick={copy}
        className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}
