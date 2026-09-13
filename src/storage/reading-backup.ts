import { bookmarkId, validateBookmark, type Bookmark } from "./bookmarks";
import { validateProgress, type ReadingProgress } from "./reading-progress";
import { validatePreferences, type ReaderPreferences } from "./reader-preferences";
import { validMetadataString, validateReadStatus, type ChapterReadStatus } from "./reading-status";

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 10000;
export interface ReadingBackup {
  application: "comic-reader"; schemaVersion: 1; exportedAt: string; libraryName: string;
  progress: ReadingProgress[]; bookmarks: Bookmark[]; readStatuses: ChapterReadStatus[]; preferences: ReaderPreferences;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) throw new Error("Backup contains missing or unsupported fields.");
}
const progressFields = ["libraryName", "seriesId", "seriesName", "chapterId", "chapterName", "pageIndex", "pageCount", "offsetRatio", "completed", "updatedAt"];
const bookmarkFields = [...progressFields.filter(k => k !== "completed"), "id", "createdAt"];
function anchor(value: Record<string, unknown>): void {
  if (![value.libraryName, value.seriesId, value.seriesName, value.chapterId, value.chapterName].every(validMetadataString)
    || !Number.isSafeInteger(value.pageIndex) || (value.pageIndex as number) < 0
    || !Number.isSafeInteger(value.pageCount) || (value.pageCount as number) < 1 || (value.pageCount as number) > 2000
    || typeof value.offsetRatio !== "number" || !Number.isFinite(value.offsetRatio)
    || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) <= 0 || (value.updatedAt as number) > 8640000000000000) throw new Error("Backup contains invalid page metadata.");
  value.pageIndex = Math.min(value.pageIndex as number, (value.pageCount as number) - 1);
  value.offsetRatio = Math.max(0, Math.min(1, value.offsetRatio as number));
}
export function parseBackup(text: string): ReadingBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup exceeds the 5 MiB limit.");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!object(data)) throw new Error("Invalid reading backup.");
  exactKeys(data, ["application", "schemaVersion", "exportedAt", "libraryName", "progress", "bookmarks", "readStatuses", "preferences"]);
  if (data.application !== "comic-reader" || data.schemaVersion !== 1) throw new Error("Unsupported application or backup schema version.");
  if (!validMetadataString(data.libraryName) || typeof data.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.exportedAt) || !Number.isFinite(Date.parse(data.exportedAt)) || new Date(data.exportedAt).toISOString() !== data.exportedAt) throw new Error("Invalid backup library name or export timestamp.");
  if (![data.progress, data.bookmarks, data.readStatuses].every(v => Array.isArray(v) && v.length <= MAX_BACKUP_RECORDS)
    || (data.progress as unknown[]).length + (data.bookmarks as unknown[]).length + (data.readStatuses as unknown[]).length > MAX_BACKUP_RECORDS) throw new Error("Backup exceeds the 10,000 total record limit.");
  const seen = new Set<string>();
  for (const [type, fields] of [["progress", progressFields], ["bookmarks", bookmarkFields], ["readStatuses", ["libraryName", "seriesId", "chapterId", "status", "updatedAt"]]] as const) {
    for (const record of data[type] as unknown[]) {
      if (!object(record)) throw new Error("Invalid backup record.");
      exactKeys(record, [...fields]);
      if (record.libraryName !== data.libraryName) throw new Error("Every record must belong to the backup library.");
      const originalIndex = record.pageIndex;
      if (type !== "readStatuses") anchor(record);
      if (type === "progress" ? !validateProgress(record) : type === "bookmarks" ? !validateBookmark({ ...record, id: bookmarkId(record as unknown as Bookmark) }) || typeof record.id !== "string" || record.id.length > 8192 : !validateReadStatus(record)) throw new Error("Invalid backup record.");
      // Validate the supplied identity before canonicalising clamped page indexes.
      if (type === "bookmarks") {
        let identity: unknown; try { identity = JSON.parse(record.id as string); } catch { throw new Error("Invalid bookmark identity."); }
        if (!Array.isArray(identity) || identity.length !== 4 || identity[0] !== record.libraryName || identity[1] !== record.seriesId || identity[2] !== record.chapterId || identity[3] !== originalIndex) throw new Error("Invalid bookmark identity.");
        record.id = bookmarkId(record as unknown as Bookmark);
      }
      const identity = JSON.stringify([type, record.libraryName, record.seriesId, record.chapterId, type === "bookmarks" ? record.pageIndex : null]);
      if (seen.has(identity)) throw new Error("Backup contains duplicate records.");
      seen.add(identity);
    }
  }
  if (!object(data.preferences)) throw new Error("Invalid reader preferences.");
  exactKeys(data.preferences, ["automaticContinuation", "zoom", "spacing", "background"]);
  if (typeof data.preferences.automaticContinuation !== "boolean" || typeof data.preferences.zoom !== "number" || !Number.isFinite(data.preferences.zoom)
    || !["none", "small", "medium", "large"].includes(data.preferences.spacing as string) || !["black", "dark", "light"].includes(data.preferences.background as string)) throw new Error("Invalid reader preferences.");
  data.preferences.zoom = Math.round(Math.max(60, Math.min(140, data.preferences.zoom)));
  data.preferences = validatePreferences(data.preferences);
  return data as unknown as ReadingBackup;
}

export function downloadBackup(backup: ReadingBackup): void {
  if (backup.progress.length + backup.bookmarks.length + backup.readStatuses.length > MAX_BACKUP_RECORDS) throw new Error("Reading data exceeds the 10,000 total backup record limit.");
  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Reading data exceeds the 5 MiB backup limit.");
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `comic-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
