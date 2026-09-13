import { operate } from "./database";
import { defaults, validatePreferences, type ReaderPreferences } from "./reader-preferences";
import { progressKey, validateProgress, type ReadingProgress } from "./reading-progress";
import { bookmarkId, validateBookmark, type Bookmark } from "./bookmarks";
import { validateReadStatus, type ChapterReadStatus } from "./reading-status";
import { metadataStores, metadataTransaction, replaceLibrary } from "./metadata-transaction";
import type { ReadingBackup } from "./reading-backup";

export interface ProgressToken { epoch: number; revision: number; key: string }
// Serialized writes order mutations against in-flight saves; tokens reject stale queued saves.
export class ReadingData {
  preferences = { ...defaults };
  available = false;
  busy = false;
  private records = new Map<string, ReadingProgress>();
  private bookmarks = new Map<string, Bookmark>();
  private statuses = new Map<string, ChapterReadStatus>();
  private revisions = new Map<string, number>();
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private epoch = 0;
  private warned = false;
  private preferenceTimer = 0;
  private preferenceDirty = false;
  private clock = 0;
  constructor(private warn: (message: string) => void) {}
  private failure(error: unknown): void {
    console.warn("Reading data storage unavailable", error);
    this.available = false;
    if (!this.warned) {
      this.warned = true;
      this.warn("Reading data cannot be saved. Bookmarks, read-state changes and backups are unavailable. Reading and preferences still work for this session.");
    }
    this.changed();
  }
  async initialize(): Promise<void> {
    const results = await Promise.allSettled([
      operate("readonly", s => s.getAll(), "progress"),
      operate("readonly", s => s.get("reader"), "preferences"),
      operate("readonly", s => s.getAll(), "bookmarks"),
      operate("readonly", s => s.getAll(), "readStatuses"),
    ]);
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      if (result.status === "rejected") { this.failure(result.reason); continue; }
      if (index === 1) { this.preferences = validatePreferences(result.value); continue; }
      for (const value of result.value as unknown[]) {
        if (index === 0 && validateProgress(value)) this.records.set(progressKey(value), value);
        if (index === 2 && validateBookmark(value)) this.bookmarks.set(value.id, value);
        if (index === 3 && validateReadStatus(value)) this.statuses.set(progressKey(value), value);
      }
    }
    this.available = results.every(r => r.status === "fulfilled");
    for (const r of [...this.records.values(), ...this.bookmarks.values(), ...this.statuses.values()]) this.clock = Math.max(this.clock, r.updatedAt);
    this.changed();
  }
  subscribe(listener: () => void): void { this.listeners.add(listener); }
  private changed(): void { this.listeners.forEach(listener => listener()); }
  private timestamp(): number { return this.clock = Math.max(Date.now(), this.clock + 1); }
  all(name: string): ReadingProgress[] { return [...this.records.values()].filter(r => r.libraryName === name); }
  allBookmarks(name: string): Bookmark[] { return [...this.bookmarks.values()].filter(r => r.libraryName === name).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)); }
  allStatuses(name: string): ChapterReadStatus[] { return [...this.statuses.values()].filter(r => r.libraryName === name); }
  token(record: Pick<ReadingProgress, "libraryName" | "seriesId" | "chapterId">): ProgressToken {
    const key = progressKey(record); return { key, epoch: this.epoch, revision: this.revisions.get(key) ?? 0 };
  }
  private validToken(token: ProgressToken): boolean { return token.epoch === this.epoch && token.revision === (this.revisions.get(token.key) ?? 0); }
  save(record: Omit<ReadingProgress, "updatedAt">, token = this.token(record)): void {
    if (this.busy || token.key !== progressKey(record) || !this.validToken(token)) return;
    const key = progressKey(record);
    const value = { ...record, completed: record.completed || Boolean(this.records.get(key)?.completed), updatedAt: this.timestamp() };
    if (!validateProgress(value)) return;
    this.records.set(key, value); this.changed();
    if (this.available) this.queue(() => this.validToken(token) ? operate("readwrite", s => s.put(value, key), "progress").then(() => {}) : Promise.resolve());
  }
  setPreferences(patch: Partial<ReaderPreferences>): void {
    if (this.busy) return;
    this.preferenceDirty = true;
    this.preferences = validatePreferences({ ...this.preferences, ...patch }); this.changed();
    window.clearTimeout(this.preferenceTimer);
    this.preferenceTimer = window.setTimeout(() => this.flushPreferences(), 300);
  }
  flushPreferences(): void {
    window.clearTimeout(this.preferenceTimer); this.preferenceTimer = 0;
    if (!this.available || this.busy || !this.preferenceDirty) return;
    this.preferenceDirty = false;
    const value = { ...this.preferences };
    this.queue(() => operate("readwrite", s => s.put(value, "reader"), "preferences").then(() => {}));
  }
  private queue(action: () => Promise<void>): void {
    const epoch = this.epoch;
    this.writes = this.writes.then(async () => { if (epoch === this.epoch) await action(); }).catch(error => this.failure(error));
  }
  private async mutate(action: () => Promise<void>, publish: () => void): Promise<void> {
    if (!this.available || this.busy) throw new Error("Saved reading-data actions are currently unavailable.");
    this.busy = true; this.changed();
    const operation = this.writes.then(action);
    this.writes = operation.catch(() => {});
    try { await operation; publish(); }
    catch (error) { this.failure(error); throw new Error("Reading data could not be updated. Existing saved data was retained."); }
    finally { this.busy = false; this.changed(); if (this.preferenceDirty) this.flushPreferences(); }
  }
  async toggleBookmark(anchor: Omit<ReadingProgress, "completed" | "updatedAt">): Promise<boolean> {
    const id = bookmarkId(anchor); const old = this.bookmarks.get(id);
    const now = this.timestamp(); const value: Bookmark = { ...anchor, id, createdAt: now, updatedAt: now };
    if (!validateBookmark(value)) throw new Error("There is no valid page to bookmark.");
    await this.mutate(() => metadataTransaction(tx => {
      const store = tx.objectStore("bookmarks"); if (old) store.delete(id); else store.put(value, id);
    }), () => { if (old) this.bookmarks.delete(id); else this.bookmarks.set(id, value); });
    return !old;
  }
  async deleteBookmark(id: string): Promise<void> {
    await this.mutate(() => metadataTransaction(tx => { tx.objectStore("bookmarks").delete(id); }), () => { this.bookmarks.delete(id); });
  }
  async markChapters(name: string, seriesId: string, chapterIds: string[], read: boolean, wholeSeries = false): Promise<void> {
    const keys = new Set(chapterIds.map(chapterId => progressKey({ libraryName: name, seriesId, chapterId })));
    if (wholeSeries) for (const r of [...this.all(name), ...this.allStatuses(name)]) if (r.seriesId === seriesId) keys.add(progressKey(r));
    if (!read) for (const key of keys) this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    const values: ChapterReadStatus[] = chapterIds.map(chapterId => ({ libraryName: name, seriesId, chapterId, status: "read", updatedAt: this.timestamp() }));
    await this.mutate(() => metadataTransaction(tx => {
      if (read) for (const value of values) tx.objectStore("readStatuses").put(value, progressKey(value));
      else for (const key of keys) { tx.objectStore("readStatuses").delete(key); tx.objectStore("progress").delete(key); }
    }), () => {
      if (read) for (const value of values) this.statuses.set(progressKey(value), value);
      else for (const key of keys) { this.statuses.delete(key); this.records.delete(key); }
    });
  }
  backup(name: string): ReadingBackup {
    if (!this.available || this.busy) throw new Error("Saved reading-data actions are currently unavailable.");
    // Explicit scalar projections prevent even obsolete/extra stored fields entering a backup.
    const progress = this.all(name).map(r => ({ libraryName: name, seriesId: r.seriesId, seriesName: r.seriesName, chapterId: r.chapterId, chapterName: r.chapterName, pageIndex: r.pageIndex, pageCount: r.pageCount, offsetRatio: r.offsetRatio, completed: r.completed, updatedAt: r.updatedAt }));
    const bookmarks = this.allBookmarks(name).map(r => ({ id: r.id, libraryName: name, seriesId: r.seriesId, seriesName: r.seriesName, chapterId: r.chapterId, chapterName: r.chapterName, pageIndex: r.pageIndex, pageCount: r.pageCount, offsetRatio: r.offsetRatio, createdAt: r.createdAt, updatedAt: r.updatedAt }));
    const readStatuses = this.allStatuses(name).map(r => ({ libraryName: name, seriesId: r.seriesId, chapterId: r.chapterId, status: r.status, updatedAt: r.updatedAt }));
    return { application: "comic-reader", schemaVersion: 1, exportedAt: new Date().toISOString(), libraryName: name, progress, bookmarks, readStatuses, preferences: { ...this.preferences } };
  }
  invalidatePending(): void {
    this.epoch++; window.clearTimeout(this.preferenceTimer); this.preferenceTimer = 0; this.preferenceDirty = false;
  }
  async replace(backup: ReadingBackup, name: string): Promise<void> {
    this.invalidatePending();
    const progress = backup.progress.map(r => ({ ...r, libraryName: name }));
    const bookmarks = backup.bookmarks.map(r => { const value = { ...r, libraryName: name }; return { ...value, id: bookmarkId(value) }; });
    const statuses = backup.readStatuses.map(r => ({ ...r, libraryName: name }));
    await this.mutate(() => metadataTransaction(tx => {
      replaceLibrary(tx.objectStore("progress"), name, progress.map(value => ({ key: progressKey(value), value })));
      replaceLibrary(tx.objectStore("bookmarks"), name, bookmarks.map(value => ({ key: value.id, value })));
      replaceLibrary(tx.objectStore("readStatuses"), name, statuses.map(value => ({ key: progressKey(value), value })));
      tx.objectStore("preferences").put(backup.preferences, "reader");
    }), () => {
      for (const [key, r] of this.records) if (r.libraryName === name) this.records.delete(key);
      for (const [key, r] of this.bookmarks) if (r.libraryName === name) this.bookmarks.delete(key);
      for (const [key, r] of this.statuses) if (r.libraryName === name) this.statuses.delete(key);
      for (const r of progress) this.records.set(progressKey(r), r);
      for (const r of bookmarks) this.bookmarks.set(r.id, r);
      for (const r of statuses) this.statuses.set(progressKey(r), r);
      for (const r of [...progress, ...bookmarks, ...statuses]) this.clock = Math.max(this.clock, r.updatedAt);
      this.preferences = { ...backup.preferences };
    });
  }
  async clear(): Promise<void> {
    this.invalidatePending();
    await this.mutate(() => metadataTransaction(tx => { for (const name of metadataStores) tx.objectStore(name).clear(); }), () => {
      this.records.clear(); this.bookmarks.clear(); this.statuses.clear(); this.preferences = { ...defaults };
    });
  }
}
