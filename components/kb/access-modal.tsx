"use client";

import { useEffect, useState } from "react";
import { messageForBody } from "@/lib/errors/messages";

const overlay = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4";
const panel = "w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg";
const buttonClass = "min-h-9 rounded-lg px-3 text-sm font-medium transition active:scale-[0.97] disabled:opacity-45";

export function AccessModal({
  path,
  isDirectory,
  groups,
  onClose,
}: {
  path: string;
  isDirectory: boolean;
  groups: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Folders have no single visibility; the GET aggregates their files and sets
  // this when those files' clearances differ, so we can warn before a bulk save.
  const [mixed, setMixed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/kb/access?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d: { visibility?: string[]; mixed?: boolean }) => {
        if (!live) return;
        setSelected(d.visibility ?? []);
        setMixed(Boolean(d.mixed));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path]);

  function toggle(group: string): void {
    setSelected((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));
  }

  async function save(): Promise<void> {
    setPending(true);
    setMessage("");
    try {
      const res = await fetch("/api/kb/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, visibility: selected }),
      });
      const json = (await res.json()) as { error?: unknown; count?: number; skipped?: string[] };
      if (!res.ok) {
        setMessage(messageForBody(json));
        return;
      }
      const skipped = json.skipped?.length ? ` (${json.skipped.length} skipped)` : "";
      setMessage(`Updated ${json.count ?? 0} file(s)${skipped}. Refresh to see the tree update.`);
    } catch {
      setMessage("Access change could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={overlay} role="dialog" aria-modal="true" aria-label="Edit access" onClick={onClose}>
      <div className={panel} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink">Edit access</h2>
        <p className="mt-1 break-all text-xs text-ink-faint">{path}{isDirectory ? " (folder, applies to all files inside)" : ""}</p>
        <div className="mt-4 flex flex-col gap-1.5">
          {loading ? (
            <p className="text-sm text-ink-faint">Loading…</p>
          ) : (
            ["all-hands", ...groups.filter((g) => g !== "all-hands")].map((group) => (
              <label key={group} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={selected.includes(group)} onChange={() => toggle(group)} />
                {group}
              </label>
            ))
          )}
        </div>
        {!loading && isDirectory && mixed && (
          <p className="mt-3 text-xs text-amber-600">Files in this folder currently have different access. The boxes show the access they all share; saving replaces every file with the selection above.</p>
        )}
        {message && <p className="mt-3 text-xs text-ink-muted">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={`${buttonClass} text-ink-muted`} onClick={onClose}>Close</button>
          <button type="button" className={`${buttonClass} bg-accent text-white`} disabled={pending || selected.length === 0} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
