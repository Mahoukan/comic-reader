import { BlobReader, ZipReader, type FileEntry } from "@zip.js/zip.js/index-native.js";
import { naturalCompareFilenames } from "../library/natural-sort";
import { ARCHIVE_LIMITS, ArchiveError, checkImageSize, imageMimeType } from "./archive-safety";

export interface ComicPage {
  id: string;
  filename: string;
  mimeType: string;
}

export interface OpenedChapter {
  pages: ComicPage[];
  loadPage(page: ComicPage): Promise<Blob>;
  close(): Promise<void>;
}

export async function openChapter(handle: FileSystemFileHandle, signal: AbortSignal): Promise<OpenedChapter> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const pages: ComicPage[] = [];
  const entries = new Map<string, FileEntry>();
  const pending = new Set<Promise<Blob>>();
  let reader: ZipReader<Blob> | null = null;
  let closed = false;
  let closing: Promise<void> | null = null;

  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    controller.abort();
    signal.removeEventListener("abort", cancel);
    pages.length = 0;
    entries.clear();
    closing = (async () => {
      await Promise.allSettled(pending);
      pending.clear();
      const previous = reader;
      reader = null;
      await previous?.close();
    })();
    return closing;
  }

  try {
    controller.signal.throwIfAborted();
    // Native getFile cannot be aborted; stop waiting so rapid chapter changes
    // can finish cleanup without letting its late result open an old archive.
    let removeFileAbort = (): void => {};
    const file = await new Promise<File>((resolve, reject) => {
      const aborted = (): void => reject(controller.signal.reason ?? new DOMException("Chapter closed", "AbortError"));
      controller.signal.addEventListener("abort", aborted, { once: true });
      removeFileAbort = () => controller.signal.removeEventListener("abort", aborted);
      void handle.getFile().then(resolve, reject);
    }).finally(() => removeFileAbort());
    controller.signal.throwIfAborted();
    // Bundled ZIP code uses browser-native codecs; no worker or external WASM downloads.
    reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: false, useCompressionStream: true,
      strictness: "strict",
      // Filter unsafe names ourselves so they can be skipped rather than aborting a valid chapter.
      // Nothing is ever extracted onto a filesystem or resolved as a URL from an entry name.
      filenameValidation: "tolerant",
    });
    let entryCount = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      controller.signal.throwIfAborted();
      if (++entryCount > ARCHIVE_LIMITS.maxEntries) throw new ArchiveError("This archive exceeds the 5,000 entry limit.");
      if (entry.directory || entry.symlink) continue;
      const mimeType = imageMimeType(entry.filename);
      if (!mimeType) continue;
      if (pages.length >= ARCHIVE_LIMITS.maxPages) throw new ArchiveError("This chapter exceeds the 2,000 image page limit.");
      checkImageSize(entry.uncompressedSize);
      if (entry.encrypted) throw new ArchiveError("Encrypted chapters are not supported. Choose an unencrypted CBZ.");
      if (![0, 8].includes(entry.compressionMethod)) throw new ArchiveError("This chapter uses an unsupported ZIP compression format.");
      const page: ComicPage = { id: String(entryCount), filename: entry.filename, mimeType };
      pages.push(page);
      entries.set(page.id, entry);
    }
    controller.signal.throwIfAborted();
    pages.sort((a, b) => naturalCompareFilenames(a.filename, b.filename));
    return {
      pages,
      loadPage(page): Promise<Blob> {
        const entry = entries.get(page.id);
        if (closed || !entry || controller.signal.aborted) return Promise.reject(new DOMException("Chapter closed", "AbortError"));
        const operation = (async (): Promise<Blob> => {
          checkImageSize(entry.uncompressedSize);
          let size = 0;
          const chunks: BlobPart[] = [];
          // Bound actual output too, even if an untrusted size field understates it.
          const output = new WritableStream<Uint8Array>({
            write(chunk) {
              controller.signal.throwIfAborted();
              size += chunk.byteLength;
              checkImageSize(size);
              chunks.push(chunk.slice().buffer as ArrayBuffer);
            },
          });
          try {
            await entry.getData(output, { signal: controller.signal, checkCrc32: true, checkOverlappingEntry: true, useWebWorkers: false });
            controller.signal.throwIfAborted();
            return new Blob(chunks, { type: page.mimeType });
          } finally { chunks.length = 0; }
        })();
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      },
      close,
    };
  } catch (error) {
    await close().catch(cleanupError => console.warn("Unable to close CBZ reader", cleanupError));
    throw error;
  }
}
