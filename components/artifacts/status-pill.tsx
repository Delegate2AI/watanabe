import { Badge } from "@/components/ui/badge";
import type { ArtifactStatus } from "@/lib/db/artifacts";

/**
 * The Draft / Ready / In review / Published status pill for an artifact
 * (spec 27). Draft is a neutral outline, Ready is the accent (proposed to
 * publish), In review keeps the accent because the work is still pending, and
 * only Published earns the "good" semantic color, because only it means the
 * note actually landed in the KB. Presentational only.
 */
const LABELS: Record<ArtifactStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  in_review: "In review",
  published: "Published",
};

const VARIANTS: Record<ArtifactStatus, "outline" | "default" | "good"> = {
  draft: "outline",
  ready: "default",
  in_review: "default",
  published: "good",
};

export function StatusPill({ status }: { status: ArtifactStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
