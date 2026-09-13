import { openChapter } from "../reader/cbz-reader";
import { MAX_THUMBNAIL_BYTES } from "../storage/cover-thumbnails";

export interface GeneratedCover { blob: Blob; width: number; height: number; mimeType: string }
const MAX_DECODED_PIXELS = 40_000_000;
const MAX_DECODED_DIMENSION = 16384;
function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > MAX_DECODED_DIMENSION || height > MAX_DECODED_DIMENSION || width * height > MAX_DECODED_PIXELS) throw new Error("Cover image dimensions exceed thumbnail decoding limits.");
}
async function decode(blob: Blob, signal: AbortSignal): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try { signal.throwIfAborted(); checkDimensions(bitmap.width, bitmap.height); }
    catch (error) { bitmap.close(); throw error; }
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const image = new Image(); const url = URL.createObjectURL(blob);
  const close = (): void => { image.removeAttribute("src"); URL.revokeObjectURL(url); };
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { close(); reject(new DOMException("Cover cancelled", "AbortError")); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      image.src = url;
      void image.decode().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted(); checkDimensions(image.naturalWidth, image.naturalHeight);
    return { image, width: image.naturalWidth, height: image.naturalHeight, close };
  } catch (error) { close(); throw error; }
}
export async function generateCover(file: File, signal: AbortSignal): Promise<GeneratedCover> {
  // Use the same File snapshot used for the fingerprint; no second getFile race.
  const archive = await openChapter({ getFile: async () => file } as FileSystemFileHandle, signal);
  let decoded: Awaited<ReturnType<typeof decode>> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    signal.throwIfAborted();
    const page = archive.pages[0]; if (!page) throw new Error("The first chapter has no supported cover image.");
    const blob = await archive.loadPage(page);
    signal.throwIfAborted(); decoded = await decode(blob, signal);
    const scale = Math.min(1, 480 / decoded.width, 640 / decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale)); const height = Math.max(1, Math.round(decoded.height * scale));
    canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.image, 0, 0, width, height);
    decoded.close(); decoded = null;
    for (const mimeType of ["image/webp", "image/jpeg", "image/png"]) {
      signal.throwIfAborted();
      const output = await new Promise<Blob | null>(resolve => {
        try { canvas!.toBlob(resolve, mimeType, .82); } catch { resolve(null); }
      });
      signal.throwIfAborted();
      if (output && ["image/webp", "image/jpeg", "image/png"].includes(output.type) && output.size > 0 && output.size <= MAX_THUMBNAIL_BYTES) return { blob: output, width, height, mimeType: output.type };
    }
    throw new Error("Cover image could not be encoded within the thumbnail limit.");
  } finally {
    decoded?.close(); if (canvas) { canvas.width = canvas.height = 0; }
    await archive.close();
  }
}
