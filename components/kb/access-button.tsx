"use client";

import { useState } from "react";
import { Shield } from "lucide-react";
import { AccessModal } from "./access-modal";

export function AccessButton({ path, isDirectory, groups }: { path: string; isDirectory: boolean; groups: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Edit access for ${path}`}
        title="Edit access"
        className="ml-auto shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-hover hover:text-ink"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Shield className="size-3.5" aria-hidden />
      </button>
      {open && <AccessModal path={path} isDirectory={isDirectory} groups={groups} onClose={() => setOpen(false)} />}
    </>
  );
}
