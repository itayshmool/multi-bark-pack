/**
 * Simple per-key async lock. Serializes async operations sharing the same key
 * while allowing different keys to proceed in parallel.
 */
const locks = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  locks.set(key, next);
  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (locks.get(key) === next) locks.delete(key);
  }
}
