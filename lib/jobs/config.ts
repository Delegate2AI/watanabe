import { timingSafeEqual } from "node:crypto";

export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim();
  return secret ? secret : null;
}

export function checkCronSecret(provided: string | null): boolean {
  const expected = cronSecret();
  if (!expected || !provided) return false;
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}
