import { validMetadataString } from "./reading-status";
export interface ReadingProgress {
  libraryName: string; seriesId: string; seriesName: string; chapterId: string; chapterName: string;
  pageIndex: number; pageCount: number; offsetRatio: number; completed: boolean; updatedAt: number;
}
export const progressKey = (record: Pick<ReadingProgress, "libraryName" | "seriesId" | "chapterId">): string => JSON.stringify([record.libraryName, record.seriesId, record.chapterId]);
export function validateProgress(value: unknown): value is ReadingProgress {
  if (!value || typeof value !== "object") return false;
  const r = value as ReadingProgress;
  return [r.libraryName, r.seriesId, r.seriesName, r.chapterId, r.chapterName].every(validMetadataString)
    && Number.isSafeInteger(r.pageIndex) && r.pageIndex >= 0 && Number.isSafeInteger(r.pageCount) && r.pageCount > 0 && r.pageCount <= 2000
    && Number.isFinite(r.offsetRatio) && r.offsetRatio >= 0 && r.offsetRatio <= 1
    && typeof r.completed === "boolean" && Number.isSafeInteger(r.updatedAt) && r.updatedAt > 0 && r.updatedAt <= 8640000000000000;
}
