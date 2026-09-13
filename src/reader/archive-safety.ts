export const ARCHIVE_LIMITS = {
  maxEntries: 5_000,
  maxPages: 2_000,
  maxImageBytes: 100 * 1024 * 1024,
} as const;

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", avif: "image/avif",
};

export class ArchiveError extends Error {}

export function imageMimeType(filename: string): string | null {
  // Backslashes, drive prefixes, control characters and dot segments are unsafe too.
  if (!filename || /^[\/\\]/.test(filename) || /[\\:\u0000-\u001f]/.test(filename)) return null;
  const segments = filename.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  const lower = segments.map(segment => segment.toLowerCase());
  if (lower.some(segment => segment === "__macosx" || segment === ".ds_store"
      || segment === "thumbnails" || segment === "thumbnail" || segment === "thumbs"
      || segment.startsWith("._"))) return null;
  const basename = lower[lower.length - 1];
  if (/^(?:thumbnail|thumb|folder)(?:[._-]|$)/.test(basename)) return null;
  const extension = basename.split(".").pop() ?? "";
  return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension] : null;
}

export function checkImageSize(size: number | bigint): void {
  if (typeof size === "bigint") {
    if (size < 0n || size > BigInt(ARCHIVE_LIMITS.maxImageBytes)) {
      throw new ArchiveError("A page exceeds the 100 MiB image limit.");
    }
  } else if (!Number.isSafeInteger(size) || size < 0 || size > ARCHIVE_LIMITS.maxImageBytes) {
    throw new ArchiveError("A page exceeds the 100 MiB image limit or has an invalid size.");
  }
}
