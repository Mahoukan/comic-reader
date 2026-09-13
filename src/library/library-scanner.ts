import { naturalCompare, naturalCompareFilenames } from "./natural-sort";

export interface ComicChapter {
  id: string;
  name: string;
  displayName: string;
  fileHandle: FileSystemFileHandle;
}

export interface ComicSeries {
  id: string;
  name: string;
  directoryHandle: FileSystemDirectoryHandle;
  chapters: ComicChapter[];
}

export interface LibraryScan {
  series: ComicSeries[];
  chapterCount: number;
  rootEntryCount: number;
  subfolderCount: number;
  inaccessibleFolders: string[];
}

export async function scanLibrary(root: FileSystemDirectoryHandle, signal: AbortSignal): Promise<LibraryScan> {
  const result: LibraryScan = { series: [], chapterCount: 0, rootEntryCount: 0, subfolderCount: 0, inaccessibleFolders: [] };
  signal.throwIfAborted();
  for await (const entry of root.values()) {
    signal.throwIfAborted();
    result.rootEntryCount++;
    if (entry.kind !== "directory") continue;
    result.subfolderCount++;
    const directory = entry as FileSystemDirectoryHandle;
    const chapters: ComicChapter[] = [];
    try {
      for await (const child of directory.values()) {
        signal.throwIfAborted();
        if (child.kind !== "file" || !/\.cbz$/i.test(child.name)) continue;
        chapters.push({
          id: JSON.stringify([directory.name, child.name]),
          name: child.name,
          displayName: child.name.replace(/\.cbz$/i, ""),
          fileHandle: child as FileSystemFileHandle,
        });
      }
      signal.throwIfAborted();
      if (chapters.length) {
        chapters.sort((a, b) => naturalCompareFilenames(a.name, b.name));
        result.series.push({ id: directory.name, name: directory.name, directoryHandle: directory, chapters });
        result.chapterCount += chapters.length;
      }
    } catch (error) {
      signal.throwIfAborted();
      // Discard this folder's incomplete chapter list, but continue with siblings.
      result.inaccessibleFolders.push(directory.name);
      console.warn("Unable to enumerate a series folder", error);
    }
  }
  signal.throwIfAborted();
  result.series.sort((a, b) => naturalCompare(a.name, b.name));
  return result;
}
