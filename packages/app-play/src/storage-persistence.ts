// Asks the browser to keep the player's storage (best records, settings, replays, saved courses, the offline caches)
// when it runs short of space. An installed player asks: Chromium grants it to an installed app without a prompt, and
// Firefox and Safari decide on their own terms.

/** The part of `navigator.storage` this reads. */
export interface PersistableStorage {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/**
 * Asks for persistent storage unless it is already granted. Resolves whether the storage is persistent, or `undefined`
 * where the browser has no such API or the call fails.
 */
export async function requestPersistentStorage(storage: PersistableStorage | undefined): Promise<boolean | undefined> {
  if (storage?.persist === undefined) return undefined;
  try {
    if ((await storage.persisted?.()) === true) return true;
    return await storage.persist();
  } catch {
    return undefined;
  }
}
