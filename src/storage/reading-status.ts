import type { ComicSeries } from "../library/library-scanner";
import type { ReadingProgress } from "./reading-progress";

export interface ChapterReadStatus {
  libraryName: string; seriesId: string; chapterId: string; status: "read"; updatedAt: number;
}
export function validMetadataString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) && !/^(?:[\/\\]|[A-Za-z]:[\/\\])/.test(value);
}
export function validateReadStatus(value: unknown): value is ChapterReadStatus {
  if (!value || typeof value !== "object") return false;
  const r = value as ChapterReadStatus;
  return [r.libraryName, r.seriesId, r.chapterId].every(validMetadataString) && r.status === "read"
    && Number.isSafeInteger(r.updatedAt) && r.updatedAt > 0 && r.updatedAt <= 8640000000000000;
}
export function chapterState(chapterId: string, progress: ReadingProgress[], statuses: ChapterReadStatus[]): "Read" | "Reading" | "Unread" {
  if (statuses.some(r => r.chapterId === chapterId) || progress.some(r => r.chapterId === chapterId && r.completed)) return "Read";
  return progress.some(r => r.chapterId === chapterId) ? "Reading" : "Unread";
}
// Only current scanned chapters count. Each read chapter contributes one, plus
// the newest incomplete, non-overridden chapter's (pageIndex + offset) / pageCount.
export function seriesProgress(series: ComicSeries, progress: ReadingProgress[], statuses: ChapterReadStatus[] = []): { state: string; percent: number } {
  const records = progress.filter(r => r.seriesId === series.id && series.chapters.some(c => c.id === r.chapterId));
  const overrides = statuses.filter(r => r.seriesId === series.id);
  const read = new Set(series.chapters.filter(c => chapterState(c.id, records, overrides) === "Read").map(c => c.id));
  const latest = records.filter(r => !read.has(r.chapterId)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const fraction = latest ? Math.min(1, (latest.pageIndex + latest.offsetRatio) / latest.pageCount) : 0;
  return { state: read.size === series.chapters.length ? "Completed" : records.length || read.size ? "Reading" : "Unread",
    percent: series.chapters.length ? Math.round(100 * (read.size + fraction) / series.chapters.length) : 0 };
}
