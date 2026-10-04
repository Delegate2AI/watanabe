import { PageSkeleton } from "@/components/skeletons/page-skeleton";
import { GridSkeleton } from "@/components/skeletons/grid-skeleton";

/** Shown while the Projects read runs, so the nav click lands immediately. */
export default function Loading() {
  return (
    <PageSkeleton>
      <GridSkeleton label="Loading your projects" />
    </PageSkeleton>
  );
}
