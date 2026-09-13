import { validateProgress, type ReadingProgress } from "./reading-progress";

export type ReadingAnchor = Pick<ReadingProgress, "pageIndex" | "offsetRatio">;
export interface Bookmark extends Omit<ReadingProgress, "completed"> {
  id: string;
  createdAt: number;
}
export const bookmarkId = (record: Pick<Bookmark, "libraryName" | "seriesId" | "chapterId" | "pageIndex">): string =>
  JSON.stringify([record.libraryName, record.seriesId, record.chapterId, record.pageIndex]);
export function validateBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== "object") return false;
  const record = value as Bookmark;
  return validateProgress({ ...record, completed: false }) && record.pageIndex < record.pageCount
    && typeof record.id === "string" && record.id === bookmarkId(record)
    && Number.isSafeInteger(record.createdAt) && record.createdAt > 0 && record.createdAt <= record.updatedAt;
}
