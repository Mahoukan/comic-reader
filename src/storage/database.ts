const DATABASE = "comic-reader";
const STORE = "library";
const KEY = "folder";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => fail(new Error("IndexedDB open timed out.")), 5000);
    function fail(error: unknown): void {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      reject(error);
    }
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onblocked = () => fail(new Error("IndexedDB is blocked by another tab."));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (finished) { database.close(); return; }
        finished = true;
        window.clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch (error) { fail(error); }
  });
}

async function operate<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const timer = window.setTimeout(() => {
        reject(new Error("IndexedDB transaction timed out."));
        transaction.abort();
      }, 5000);
      transaction.onabort = transaction.onerror = () => {
        window.clearTimeout(timer);
        reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      };
      try {
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          window.clearTimeout(timer);
          resolve(request.result);
        };
      } catch (error) {
        window.clearTimeout(timer);
        transaction.abort();
        reject(error);
      }
    });
  } finally { database.close(); }
}

export async function getSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle: unknown = await operate("readonly", store => store.get(KEY));
  if (handle == null) return null;
  if (typeof handle !== "object" || !("kind" in handle) || handle.kind !== "directory"
      || !("queryPermission" in handle) || typeof handle.queryPermission !== "function") {
    throw new Error("Saved folder handle is invalid.");
  }
  return handle as FileSystemDirectoryHandle;
}

export async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  await operate("readwrite", store => store.put(handle, KEY));
}

export async function removeSavedFolder(): Promise<void> {
  await operate("readwrite", store => store.delete(KEY));
}
