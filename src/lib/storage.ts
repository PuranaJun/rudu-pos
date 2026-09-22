/**
 * Ask the browser to make IndexedDB durable. Must be called from a normal
 * (non-user-path) context and never awaited by anything the operator is doing.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
