const chains = new Map<string, Promise<void>>();

export function withSkillSlugLock<T>(slug: string, work: () => Promise<T>): Promise<T> {
  const key = slug.trim().toLowerCase();
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

export function skillSlugLockDepth(): number {
  return chains.size;
}
