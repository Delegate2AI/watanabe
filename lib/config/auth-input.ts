const MODE_BLOCKS: Readonly<Record<string, string>> = {
  "proxy-header": "proxyHeader",
  jwt: "jwt",
  none: "none",
  oidc: "oidc",
};

export function dropInactiveAuthBlocks(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const active = typeof record.mode === "string" ? MODE_BLOCKS[record.mode] : undefined;
  if (active === undefined) return input;
  const inactive = new Set(Object.values(MODE_BLOCKS).filter((block) => block !== active));
  return Object.fromEntries(Object.entries(record).filter(([key]) => !inactive.has(key)));
}
