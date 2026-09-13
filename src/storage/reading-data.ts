import { openDatabase, operate } from "./database";
import { defaults, validatePreferences, type ReaderPreferences } from "./reader-preferences";
import { progressKey, validateProgress, type ReadingProgress } from "./reading-progress";

// One ordered write queue also orders clear against writes already in flight.
export class ReadingData {
  preferences = { ...defaults };
  private records = new Map<string, ReadingProgress>();
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private epoch = 0;
  private warned = false;
  private preferenceTimer = 0;
  private clock = 0;
  constructor(private warn: (message: string) => void) {}
  private failure(error: unknown): void {
    console.warn("Reading data storage unavailable", error);
    if (!this.warned) { this.warned = true; this.warn("Reading progress cannot be saved on this device. Reader preferences work for this session."); }
  }
  async initialize(): Promise<void> {
    const results = await Promise.allSettled([
      operate("readonly", store => store.getAll(), "progress"),
      operate("readonly", store => store.get("reader"), "preferences"),
    ]);
    const progress = results[0]; const preferences = results[1];
    if (progress.status === "fulfilled") { for (const value of progress.value) if (validateProgress(value)) { this.records.set(progressKey(value), value); this.clock = Math.max(this.clock, value.updatedAt); } }
    else this.failure(progress.reason);
    if (preferences.status === "fulfilled") this.preferences = validatePreferences(preferences.value);
    else this.failure(preferences.reason);
  }
  subscribe(listener: () => void): void { this.listeners.add(listener); }
  private changed(): void { this.listeners.forEach(listener => listener()); }
  all(libraryName: string): ReadingProgress[] { return [...this.records.values()].filter(r => r.libraryName === libraryName); }
  save(record: Omit<ReadingProgress, "updatedAt">): void {
    const key = progressKey(record);
    const previous = this.records.get(key);
    const value = { ...record, completed: record.completed || Boolean(previous?.completed), updatedAt: this.clock = Math.max(Date.now(), this.clock + 1) };
    this.records.set(key, value); this.changed();
    this.queue(() => operate("readwrite", store => store.put(value, key), "progress").then(() => {}));
  }
  setPreferences(patch: Partial<ReaderPreferences>): void {
    this.preferences = validatePreferences({ ...this.preferences, ...patch }); this.changed();
    window.clearTimeout(this.preferenceTimer);
    this.preferenceTimer = window.setTimeout(() => this.flushPreferences(), 300);
  }
  flushPreferences(): void {
    window.clearTimeout(this.preferenceTimer); this.preferenceTimer = 0;
    const value = { ...this.preferences };
    this.queue(() => operate("readwrite", store => store.put(value, "reader"), "preferences").then(() => {}));
  }
  private queue(action: () => Promise<void>): void {
    const epoch = this.epoch;
    this.writes = this.writes.then(async () => { if (epoch === this.epoch) await action(); }).catch(error => this.failure(error));
  }
  async clear(): Promise<void> {
    this.epoch++; window.clearTimeout(this.preferenceTimer); this.preferenceTimer = 0;
    this.records.clear(); this.preferences = { ...defaults }; this.changed();
    this.queue(async () => {
      const db = await openDatabase();
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["progress", "preferences"], "readwrite");
        tx.objectStore("progress").clear(); tx.objectStore("preferences").clear();
        const timer = window.setTimeout(() => { reject(new Error("Clearing reading data timed out.")); tx.abort(); }, 5000);
        tx.oncomplete = () => { window.clearTimeout(timer); resolve(); };
        tx.onabort = tx.onerror = () => { window.clearTimeout(timer); reject(tx.error); };
      }); } finally { db.close(); }
    });
    await this.writes;
  }
}
