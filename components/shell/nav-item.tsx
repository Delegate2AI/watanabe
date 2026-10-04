"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRouteActive } from "./nav-active";

/**
 * A primary sidebar entry (spec 18). Active state derives from the real route
 * (`usePathname`), not a mock panel-swap: the active pill is a raised surface
 * with an accent icon. Home ("/") matches only the exact root; every other
 * section also matches its nested routes (e.g. /kb matches /kb/01-product).
 */
export function NavItem({
  href,
  icon: Icon,
  label,
  count,
  onNavigate,
}: {
  href: string;
  icon: ComponentType<LucideProps>;
  label: string;
  count?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isRouteActive(href, pathname);

  return (
    <Link
      href={href}
      data-active={active}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[13.5px] transition-colors",
        active
          ? "bg-surface font-medium text-ink shadow-card"
          : "text-ink-muted hover:bg-surface-hover hover:text-ink",
      )}
    >
      <Icon
        className={cn("size-4", active ? "text-accent" : "text-current")}
        aria-hidden
      />
      {label}
      {typeof count === "number" && (
        <span className="ml-auto rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold tracking-wide text-accent-ink">
          {count}
        </span>
      )}
    </Link>
  );
}
