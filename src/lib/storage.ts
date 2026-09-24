export type StorageDurability = 'granted' | 'denied' | 'unsupported';

/**
 * Ask the browser to make IndexedDB durable (CLAUDE.md §13). Called once at
 * launch and never awaited by anything the operator is doing.
 *
 * iOS can still evict storage from a web app it does not consider durable —
 * that is why a denial is worth telling the operator about, once.
 */
export async function requestPersistentStorage(): Promise<StorageDurability> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
