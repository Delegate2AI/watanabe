import Link from "next/link";
import { CornerUpLeft } from "lucide-react";
import type { Backlink } from "@/lib/kb/backlinks";

/**
 * The "Referenced by" panel (spec 25). Lists the in-projection notes that link
 * to the current note. The list comes from a per-projection graph, so a
 * restricted referrer never leaks. Renders nothing when there are no backlinks.
 */
export function Backlinks({ links }: { links: Backlink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-label="Referenced by" className="mt-8 border-t border-line-soft pt-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <CornerUpLeft className="size-3" aria-hidden />
        Referenced by
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {links.map((link) => (
          <li key={link.route}>
            <Link
              href={`/kb/${link.route.split("/").map(encodeURIComponent).join("/")}`}
              className="text-[13px] text-accent hover:underline"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
