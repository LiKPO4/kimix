/**
 * IndexedDB-backed state storage with localStorage fallback.
 *
 * Replaces the previous localStorage-only persistence for large conversation
 * state (sessions, pending messages, images) to avoid silent quota errors.
 */

export interface StoredImage {
  id: string;
  name: string;
  kind?: "image" | "file";
  dataUrl: string;
  filePath?: string;
}

const DB_NAME = "kimix-state";
const DB_VERSION = 1;
const STATE_STORE = "state";
const IMAGES_STORE = "images";

const FALLBACK_IMAGE_PREFIX = "kimix_image_ref_";

function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window && !!window.indexedDB;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("IndexedDB open blocked by another tab"));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: "id" });
      }
    };
  });
  return dbPromise;
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function migrateFromLocalStorage(key: string): Promise<string | null> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return raw;
  } catch {
    return null;
  }
}

async function tryGetStateItemFromIndexedDB<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const tx = db.transaction(STATE_STORE, "readonly");
  const store = tx.objectStore(STATE_STORE);
  const request = store.get(key);

  const raw = await new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed"));
  });

  if (raw && typeof raw === "object" && "value" in raw) {
    try {
      return JSON.parse((raw as { value: string }).value) as T;
    } catch {
      return null;
    }
  }

  return null;
}

export async function getStateItem<T>(key: string): Promise<T | null> {
  if (!isIndexedDBAvailable()) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  try {
    const value = await tryGetStateItemFromIndexedDB<T>(key);
    if (value !== null) return value;
  } catch (error) {
    console.warn(`[stateStorage] IndexedDB read failed for ${key}, falling back to localStorage:`, error);
    dbPromise = null;
  }

  const migrated = await migrateFromLocalStorage(key);
  if (migrated !== null) {
    try {
      await setStateItem(key, JSON.parse(migrated) as T);
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore cleanup failure; the migrated value is already in IndexedDB.
      }
    } catch (error) {
      console.warn(`[stateStorage] Failed to migrate ${key} to IndexedDB, keeping localStorage fallback:`, error);
    }
    return JSON.parse(migrated) as T;
  }

  return null;
}

export async function setStateItem<T>(key: string, value: T): Promise<void> {
  const payload = JSON.stringify(value);

  if (!isIndexedDBAvailable()) {
    try {
      localStorage.setItem(key, payload);
      return;
    } catch (error) {
      throw new Error(`localStorage write failed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const db = await openDb();
  const tx = db.transaction(STATE_STORE, "readwrite");
  const store = tx.objectStore(STATE_STORE);
  store.put({ key, value: payload });
  await transactionComplete(tx);

  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup of the legacy localStorage copy.
  }
}

export async function removeStateItem(key: string): Promise<void> {
  if (!isIndexedDBAvailable()) {
    try {
      localStorage.removeItem(key);
      return;
    } catch {
      return;
    }
  }

  const db = await openDb();
  const tx = db.transaction(STATE_STORE, "readwrite");
  const store = tx.objectStore(STATE_STORE);
  store.delete(key);
  await transactionComplete(tx);

  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup.
  }
}

export async function storeImages(images: StoredImage[]): Promise<void> {
  if (images.length === 0) return;

  if (!isIndexedDBAvailable()) {
    for (const image of images) {
      try {
        localStorage.setItem(FALLBACK_IMAGE_PREFIX + image.id, JSON.stringify(image));
      } catch (error) {
        throw new Error(`localStorage image write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return;
  }

  const db = await openDb();
  const tx = db.transaction(IMAGES_STORE, "readwrite");
  const store = tx.objectStore(IMAGES_STORE);
  for (const image of images) {
    store.put(image);
  }
  await transactionComplete(tx);
}

export async function commitState(stateEntries: { key: string; value: unknown }[], images: StoredImage[]): Promise<void> {
  if (stateEntries.length === 0 && images.length === 0) return;

  if (!isIndexedDBAvailable()) {
    for (const entry of stateEntries) {
      localStorage.setItem(entry.key, JSON.stringify(entry.value));
    }
    for (const image of images) {
      localStorage.setItem(FALLBACK_IMAGE_PREFIX + image.id, JSON.stringify(image));
    }
    return;
  }

  const db = await openDb();
  const tx = db.transaction([STATE_STORE, IMAGES_STORE], "readwrite");
  const stateStore = tx.objectStore(STATE_STORE);
  const imageStore = tx.objectStore(IMAGES_STORE);
  for (const entry of stateEntries) {
    stateStore.put({ key: entry.key, value: JSON.stringify(entry.value) });
  }
  for (const image of images) {
    imageStore.put(image);
  }
  await transactionComplete(tx);

  for (const entry of stateEntries) {
    try { localStorage.removeItem(entry.key); } catch {}
  }
}

export async function loadImages(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return map;

  if (!isIndexedDBAvailable()) {
    for (const id of uniqueIds) {
      try {
        const raw = localStorage.getItem(FALLBACK_IMAGE_PREFIX + id);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredImage;
          if (parsed.dataUrl) map.set(id, parsed.dataUrl);
        }
      } catch {
        // Ignore individual image load failures.
      }
    }
    return map;
  }

  const db = await openDb();
  const tx = db.transaction(IMAGES_STORE, "readonly");
  const store = tx.objectStore(IMAGES_STORE);
  await Promise.all(
    uniqueIds.map(
      (id) =>
        new Promise<void>((resolve) => {
          const request = store.get(id);
          request.onsuccess = () => {
            const result = request.result as StoredImage | undefined;
            if (result?.dataUrl) map.set(id, result.dataUrl);
            resolve();
          };
          request.onerror = () => resolve();
        })
    )
  );
  return map;
}

export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  if (!isIndexedDBAvailable()) {
    for (const id of ids) {
      try {
        localStorage.removeItem(FALLBACK_IMAGE_PREFIX + id);
      } catch {
        // Ignore.
      }
    }
    return;
  }

  const db = await openDb();
  const tx = db.transaction(IMAGES_STORE, "readwrite");
  const store = tx.objectStore(IMAGES_STORE);
  for (const id of ids) {
    store.delete(id);
  }
  await transactionComplete(tx);
}

export async function getAllImageIds(): Promise<string[]> {
  if (!isIndexedDBAvailable()) {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(FALLBACK_IMAGE_PREFIX)) {
        ids.push(key.slice(FALLBACK_IMAGE_PREFIX.length));
      }
    }
    return ids;
  }

  const db = await openDb();
  const tx = db.transaction(IMAGES_STORE, "readonly");
  const store = tx.objectStore(IMAGES_STORE);
  const request = store.getAllKeys();
  const keys = await new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB getAllKeys failed"));
  });
  return keys.filter((key): key is string => typeof key === "string");
}
