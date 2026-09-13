import { openDatabase, operate } from "./database";

export interface CoverThumbnailRecord {
  libraryName: string; seriesId: string; seriesName: string;
  sourceChapterId: string; sourceFilename: string; sourceSize: number; sourceLastModified: number;
  mimeType: string; width: number; height: number; blob: Blob; updatedAt: number;
}
export interface CoverSource { sourceChapterId: string; sourceFilename: string; sourceSize: number; sourceLastModified: number }
const coverKey = (name: string, seriesId: string): string => JSON.stringify([name, seriesId]);
export const MAX_THUMBNAIL_BYTES = 1024 * 1024;
function validThumbnail(value: unknown): value is CoverThumbnailRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as CoverThumbnailRecord;
  return [r.libraryName, r.seriesId, r.seriesName, r.sourceChapterId, r.sourceFilename].every(v => typeof v === "string" && v.length <= 2048)
    && Number.isSafeInteger(r.sourceSize) && r.sourceSize >= 0 && Number.isSafeInteger(r.sourceLastModified) && r.sourceLastModified >= 0
    && Number.isInteger(r.width) && r.width > 0 && r.width <= 480 && Number.isInteger(r.height) && r.height > 0 && r.height <= 640
    && ["image/webp", "image/jpeg", "image/png"].includes(r.mimeType) && r.blob instanceof Blob
    && r.blob.type === r.mimeType && r.blob.size > 0 && r.blob.size <= MAX_THUMBNAIL_BYTES
    && Number.isSafeInteger(r.updatedAt) && r.updatedAt > 0;
}
export function matchesSource(record: CoverThumbnailRecord, source: CoverSource): boolean {
  return record.sourceChapterId === source.sourceChapterId && record.sourceFilename === source.sourceFilename
    && record.sourceSize === source.sourceSize && record.sourceLastModified === source.sourceLastModified;
}

// A small LRU supports session-only covers without retaining an entire library's Blobs.
export class CoverThumbnails {
  private memory = new Map<string, CoverThumbnailRecord>();
  private writes: Promise<void> = Promise.resolve();
  private epochs = new Map<string, number>();
  private unavailable = false;
  private released = false;
  constructor(private explain: () => void) {}
  private failure(error: unknown): void {
    if (!this.unavailable) { console.warn("Cover cache storage unavailable", error); this.unavailable = true; this.explain(); }
  }
  private remember(key: string, value: CoverThumbnailRecord): void {
    this.memory.delete(key); this.memory.set(key, value);
    while (this.memory.size > 24) this.memory.delete(this.memory.keys().next().value!);
  }
  async get(name: string, seriesId: string): Promise<CoverThumbnailRecord | null> {
    if (this.released) return null;
    const key = coverKey(name, seriesId);
    const epoch = this.epochs.get(name) ?? 0;
    const memory = this.memory.get(key);
    if (memory) { this.remember(key, memory); return memory; }
    if (this.unavailable) return null;
    try {
      const value: unknown = await operate("readonly", s => s.get(key), "covers");
      if (this.released || epoch !== (this.epochs.get(name) ?? 0)) return null;
      if (!validThumbnail(value) || value.libraryName !== name || value.seriesId !== seriesId) return null;
      this.remember(key, value); return value;
    } catch (error) { this.failure(error); return null; }
  }
  async put(record: CoverThumbnailRecord, current: () => boolean): Promise<void> {
    if (!validThumbnail(record)) throw new Error("Generated cover thumbnail is invalid.");
    const epoch = this.epochs.get(record.libraryName) ?? 0;
    const valid = (): boolean => !this.released && current() && epoch === (this.epochs.get(record.libraryName) ?? 0);
    if (!valid()) return;
    const key = coverKey(record.libraryName, record.seriesId);
    this.remember(key, record);
    this.writes = this.writes.then(async () => {
      if (!valid() || this.unavailable) return;
      await operate("readwrite", s => valid() ? s.put(record, key) : s.get(key), "covers");
    }).catch(error => this.failure(error));
    await this.writes;
  }
  async delete(name: string, seriesId: string): Promise<void> {
    this.memory.delete(coverKey(name, seriesId));
    this.writes = this.writes.then(async () => { if (!this.unavailable) await operate("readwrite", s => s.delete(coverKey(name, seriesId)), "covers"); }).catch(error => this.failure(error));
    await this.writes;
  }
  private async removeWhere(name: string, remove: (seriesId: string) => boolean, current: () => boolean): Promise<void> {
    for (const [key, r] of this.memory) if (r.libraryName === name && remove(r.seriesId)) this.memory.delete(key);
    this.writes = this.writes.then(async () => {
      if (this.unavailable || !current()) return;
      const db = await openDatabase();
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("covers", "readwrite");
        const timer = window.setTimeout(() => { reject(new Error("Cover cleanup timed out.")); tx.abort(); }, 5000);
        tx.oncomplete = () => { window.clearTimeout(timer); resolve(); };
        tx.onabort = () => { window.clearTimeout(timer); reject(tx.error); };
        const request = tx.objectStore("covers").openCursor();
        request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          let identity: unknown;
          try { identity = typeof cursor.primaryKey === "string" ? JSON.parse(cursor.primaryKey) : null; } catch { identity = null; }
          const key = Array.isArray(identity) && identity.length === 2 ? identity : null;
          if (current() && (key?.[0] === name || cursor.value?.libraryName === name)
            && remove(typeof key?.[1] === "string" ? key[1] : cursor.value?.seriesId)) cursor.delete();
          cursor.continue();
        };
      }); } finally { db.close(); }
    }).catch(error => this.failure(error));
    await this.writes;
  }
  async clear(name: string): Promise<void> {
    this.epochs.set(name, (this.epochs.get(name) ?? 0) + 1);
    await this.removeWhere(name, () => true, () => true);
  }
  async prune(name: string, seriesIds: Set<string>, current: () => boolean): Promise<void> {
    if (current()) await this.removeWhere(name, id => !seriesIds.has(id), current);
  }
  release(): void { this.released = true; this.memory.clear(); }
}
