import type { ComicSeries } from "../library/library-scanner";
export interface ReadingProgress {
  libraryName: string; seriesId: string; seriesName: string; chapterId: string; chapterName: string;
  pageIndex: number; pageCount: number; offsetRatio: number; completed: boolean; updatedAt: number;
}
export const progressKey = (record: Pick<ReadingProgress, "libraryName" | "seriesId" | "chapterId">): string => JSON.stringify([record.libraryName, record.seriesId, record.chapterId]);
export function validateProgress(value: unknown): value is ReadingProgress {
  if (!value || typeof value !== "object") return false;
  const r = value as ReadingProgress;
  return [r.libraryName, r.seriesId, r.seriesName, r.chapterId, r.chapterName].every(v => typeof v === "string")
    && Number.isInteger(r.pageIndex) && r.pageIndex >= 0 && Number.isInteger(r.pageCount) && r.pageCount > 0
    && Number.isFinite(r.offsetRatio) && r.offsetRatio >= 0 && r.offsetRatio <= 1
    && typeof r.completed === "boolean" && Number.isFinite(r.updatedAt) && r.updatedAt > 0;
}
// Each completed chapter contributes one; only the latest incomplete chapter contributes
// (pageIndex + offsetRatio) / pageCount. Divide by current scanned chapter count.
export function seriesProgress(series: ComicSeries, records: ReadingProgress[]): { state: string; percent: number } {
  const valid = records.filter(r => r.seriesId === series.id && series.chapters.some(c => c.id === r.chapterId));
  const completed = valid.filter(r => r.completed).length;
  const latest = valid.filter(r => !r.completed).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const fraction = latest ? Math.min(1, (latest.pageIndex + latest.offsetRatio) / latest.pageCount) : 0;
  return { state: completed === series.chapters.length ? "Completed" : valid.length ? "Reading" : "Unread", percent: Math.round(100 * (completed + fraction) / series.chapters.length) };
}
