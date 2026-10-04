import { PageSkeleton } from "@/components/skeletons/page-skeleton";
import { ListSkeleton } from "@/components/skeletons/list-skeleton";

/**
 * Shown while the task reads run, so the nav click lands immediately. The wider
 * column matches the Tasks surface's own `max-w-6xl`.
 */
export default function Loading() {
  return (
    <PageSkeleton wide>
      <ListSkeleton rows={6} label="Loading the team's tasks" />
    </PageSkeleton>
  );
}
