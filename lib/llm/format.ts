/** 950, 12k, 1.5M, 2B: compact token counts for budgets and usage. */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  const unit = abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : abs >= 1e3 ? ["k", 1e3] : null;
  if (!unit) return String(Math.round(n));
  const value = n / (unit[1] as number);
  return `${Number.isInteger(value) || Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}${unit[0]}`;
}

/** Share of a limit used, clamped to 0..100; 0 for an unlimited budget. */
export function usedPercent(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return limit === 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}
