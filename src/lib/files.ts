/**
 * Playlist files picked by the user (.m3u). They can be many MB, too big for the
 * localStorage that holds the profiles, so the text lives in IndexedDB keyed by profile id.
 */
const DB = "hurricanetv-files";
const STORE = "playlists";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const savePlaylist = (id: string, text: string) => run("readwrite", (s) => s.put(text, id)).then(() => undefined);
export const loadPlaylist = (id: string) => run<string | undefined>("readonly", (s) => s.get(id));
export const deletePlaylist = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined).catch(() => undefined);
