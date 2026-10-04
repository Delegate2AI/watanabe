import { PageSkeleton } from "@/components/skeletons/page-skeleton";
import { ListSkeleton } from "@/components/skeletons/list-skeleton";

/** Shown while the vault read runs, so the nav click lands immediately. */
export default function Loading() {
  return (
    <PageSkeleton>
      <ListSkeleton rows={6} label="Loading your meetings" />
    </PageSkeleton>
  );
}
