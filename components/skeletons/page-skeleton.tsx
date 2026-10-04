import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/**
 * The loading state for a content route: the same container and header shape
 * every surface uses (see `PageHeader`), with the route's own body placeholder
 * inside it.
 *
 * This is what a route's `loading.tsx` renders. Without one, a navigation to a
 * server-rendered route shows the PAGE THE USER IS LEAVING until the new one is
 * fully built, so clicking a nav item appears to do nothing for as long as the
 * read takes. With one, the shell swaps instantly and only the body waits.
 *
 * The bars mirror the real header's rhythm (eyebrow, title, one line of
 * description) so the content lands where the placeholder sat instead of
 * shifting the page.
 *
 * The header bars carry no `role="status"` of their own: the body skeleton
 * passed as `children` owns the single announcement, so a screen reader hears
 * "loading" once for the route rather than twice.
 */
export function PageSkeleton({
  wide = false,
  children,
}: {
  /** Match the surfaces that use the wider `max-w-6xl` column (Tasks). */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("mx-auto px-8 pb-14 pt-16", wide ? "max-w-6xl" : "max-w-5xl")}>
      <header className="mb-6" aria-hidden="true">
        <Skeleton className="mb-2.5 h-3.5 w-24" />
        <Skeleton className="mb-2.5 h-7 w-[22rem] max-w-full" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </header>
      {children}
    </div>
  );
}
