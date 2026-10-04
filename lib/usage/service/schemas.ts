import { z } from "zod";
import { defaultUsagePeriod, isUsageDay } from "../window";

const usageDay = z.string().refine(isUsageDay);

export const UsagePeriodShape = {
  from: usageDay.optional(),
  to: usageDay.optional(),
};

export const UsagePeriodInput = z.object(UsagePeriodShape);
export type UsagePeriodInput = z.infer<typeof UsagePeriodInput>;

export const OwnerThreadsShape = {
  ...UsagePeriodShape,
  owner: z.string().email(),
};

export const OwnerThreadsInput = z.object(OwnerThreadsShape);
export type OwnerThreadsInput = z.infer<typeof OwnerThreadsInput>;

export function resolvePeriod(input: UsagePeriodInput): { from: string; to: string } {
  const fallback = defaultUsagePeriod();
  return { from: input.from ?? fallback.from, to: input.to ?? fallback.to };
}
