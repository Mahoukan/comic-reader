import { openDatabase } from "./database";

export const metadataStores = ["progress", "bookmarks", "readStatuses", "preferences"];
export async function metadataTransaction(action: (transaction: IDBTransaction) => void): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(metadataStores, "readwrite");
      const timer = window.setTimeout(() => { reject(new Error("Reading data transaction timed out.")); tx.abort(); }, 5000);
      tx.oncomplete = () => { window.clearTimeout(timer); resolve(); };
      tx.onabort = () => { window.clearTimeout(timer); reject(tx.error ?? new Error("Reading data transaction was cancelled.")); };
      try { action(tx); } catch (error) { window.clearTimeout(timer); tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export function replaceLibrary(store: IDBObjectStore, libraryName: string, records: { key: string; value: unknown }[]): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      if (cursor.value?.libraryName === libraryName) cursor.delete();
      cursor.continue();
    } else for (const record of records) store.put(record.value, record.key);
  };
}
