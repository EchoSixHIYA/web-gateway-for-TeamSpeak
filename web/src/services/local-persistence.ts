const DB_NAME = "webspeak-local";
const DB_VERSION = 1;
const CURRENT_IDENTITY_KEY = "current";
const PREFERENCES_KEY = "singleton";

export interface StoredIdentity {
  id: string;
  label?: string;
  privateMaterial: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface FavoriteServer {
  id: string;
  label: string;
  address: string;
  nickname?: string;
  identityId?: string;
  lastChannelHint?: { id?: string; name?: string };
}

export interface RecentServer {
  id: string;
  address: string;
  nickname?: string;
  identityId?: string;
  lastConnectedAt: number;
  lastChannelHint?: { id?: string; name?: string };
}

export interface LocalPreferences {
  schemaVersion: 1;
  locale?: "auto" | "zh-CN" | "en";
  theme?: "system" | "light" | "dark";
  microphoneMuted?: boolean;
  voxThreshold?: number;
  language?: "zh" | "en" | "de";
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  inputGain?: number;
  outputVolume?: number;
  notificationVolume?: number;
  lastNickname?: string;
  inputDeviceId?: string;
  volumesByUid?: Record<string, number>;
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function isLocalPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isLocalPersistenceAvailable()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("identities")) database.createObjectStore("identities", { keyPath: "id" });
      if (!database.objectStoreNames.contains("preferences")) database.createObjectStore("preferences", { keyPath: "id" });
      if (!database.objectStoreNames.contains("favorites")) database.createObjectStore("favorites", { keyPath: "id" });
      if (!database.objectStoreNames.contains("recent")) database.createObjectStore("recent", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise!;
}

async function request<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    action(transaction.objectStore(storeName), resolve, reject);
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage transaction failed"));
  });
}

export async function loadStoredIdentity(): Promise<StoredIdentity | null> {
  try {
    return await request<StoredIdentity | null>("identities", "readonly", (store, resolve, reject) => {
      const get = store.get(CURRENT_IDENTITY_KEY);
      get.onsuccess = () => resolve((get.result as StoredIdentity | undefined) ?? null);
      get.onerror = () => reject(get.error);
    });
  } catch {
    return null;
  }
}

export async function saveStoredIdentity(privateMaterial: string, label = "此设备"): Promise<boolean> {
  try {
    const existing = await loadStoredIdentity();
    await request("identities", "readwrite", (store, resolve, reject) => {
      const put = store.put({
        id: CURRENT_IDENTITY_KEY,
        label,
        privateMaterial,
        createdAt: existing?.createdAt ?? Date.now(),
        lastUsedAt: Date.now(),
      } satisfies StoredIdentity);
      put.onsuccess = () => resolve(undefined);
      put.onerror = () => reject(put.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function removeStoredIdentity(): Promise<void> {
  try {
    await request("identities", "readwrite", (store, resolve, reject) => {
      const remove = store.delete(CURRENT_IDENTITY_KEY);
      remove.onsuccess = () => resolve(undefined);
      remove.onerror = () => reject(remove.error);
    });
  } catch {
    // Identity removal is best effort when browser storage is unavailable.
  }
}

export async function loadLocalPreferences(): Promise<LocalPreferences> {
  const defaults: LocalPreferences = { schemaVersion: 1, volumesByUid: {} };
  try {
    const value = await request<(LocalPreferences & { id: string }) | null>("preferences", "readonly", (store, resolve, reject) => {
      const get = store.get(PREFERENCES_KEY);
      get.onsuccess = () => resolve((get.result as (LocalPreferences & { id: string }) | undefined) ?? null);
      get.onerror = () => reject(get.error);
    });
    if (!value || value.schemaVersion !== 1) return defaults;
    return { ...defaults, ...value, volumesByUid: { ...defaults.volumesByUid, ...value.volumesByUid } };
  } catch {
    return defaults;
  }
}

export async function saveLocalPreferences(preferences: LocalPreferences): Promise<void> {
  try {
    const existing = await loadLocalPreferences();
    await request("preferences", "readwrite", (store, resolve, reject) => {
      const put = store.put({
        ...existing,
        ...preferences,
        volumesByUid: { ...existing.volumesByUid, ...preferences.volumesByUid },
        id: PREFERENCES_KEY,
      });
      put.onsuccess = () => resolve(undefined);
      put.onerror = () => reject(put.error);
    });
  } catch {
    // Local preference persistence is optional and never blocks joining.
  }
}

export async function listFavorites(): Promise<FavoriteServer[]> {
  try {
    return await request<FavoriteServer[]>("favorites", "readonly", (store, resolve, reject) => {
      const get = store.getAll();
      get.onsuccess = () => resolve((get.result as FavoriteServer[]).sort((a, b) => a.label.localeCompare(b.label)));
      get.onerror = () => reject(get.error);
    });
  } catch {
    return [];
  }
}

export async function saveFavorite(favorite: FavoriteServer): Promise<void> {
  try {
    await request("favorites", "readwrite", (store, resolve, reject) => {
      const put = store.put(favorite);
      put.onsuccess = () => resolve(undefined);
      put.onerror = () => reject(put.error);
    });
  } catch {
    // Favorites are an optional convenience.
  }
}

export async function removeFavorite(id: string): Promise<void> {
  try {
    await request("favorites", "readwrite", (store, resolve, reject) => {
      const remove = store.delete(id);
      remove.onsuccess = () => resolve(undefined);
      remove.onerror = () => reject(remove.error);
    });
  } catch {
    // Favorites are an optional convenience.
  }
}

export async function listRecentServers(): Promise<RecentServer[]> {
  try {
    const recent = await request<RecentServer[]>("recent", "readonly", (store, resolve, reject) => {
      const get = store.getAll();
      get.onsuccess = () => resolve(get.result as RecentServer[]);
      get.onerror = () => reject(get.error);
    });
    return recent.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, 10);
  } catch {
    return [];
  }
}

export async function recordRecentServer(server: RecentServer): Promise<void> {
  try {
    await request("recent", "readwrite", (store, resolve, reject) => {
      const put = store.put(server);
      put.onsuccess = () => resolve(undefined);
      put.onerror = () => reject(put.error);
    });
    const all = await request<RecentServer[]>("recent", "readonly", (store, resolve, reject) => {
      const get = store.getAll();
      get.onsuccess = () => resolve(get.result as RecentServer[]);
      get.onerror = () => reject(get.error);
    });
    all.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
    for (const old of all.slice(10)) await removeRecentServer(old.id);
  } catch {
    // Recent servers are an optional convenience.
  }
}

async function removeRecentServer(id: string): Promise<void> {
  await request("recent", "readwrite", (store, resolve, reject) => {
    const remove = store.delete(id);
    remove.onsuccess = () => resolve(undefined);
    remove.onerror = () => reject(remove.error);
  });
}

export async function clearLocalData(): Promise<void> {
  try {
    const database = await openDatabase();
    await Promise.all(["identities", "preferences", "favorites", "recent"].map((storeName) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Local storage clear failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local storage clear aborted"));
    })));
  } catch {
    // Clearing local data is best effort when storage is unavailable.
  }
}
