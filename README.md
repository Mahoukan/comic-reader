# Comic Reader

An installable, offline-first web reader for local CBZ comic libraries.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. Milestone 4 is complete: select a chapter in a real series to read its image pages vertically. The library supports natural sorting, search, chapter counts, and series detail lists. Milestone 5 will add seamless next-chapter continuation.

Choose a folder using the header or Library/Settings controls. Its directory handle is saved in native IndexedDB on this device. On launch, the app queries read permission without prompting. If permission needs renewal, click **Reconnect folder**. **Change folder** opens a new picker; **Disconnect folder** confirms before removing the saved connection, without changing local files.

Persistent folder access requires the directory-picker API, currently available in compatible Chromium-based browsers such as desktop Chrome and Edge, on HTTPS or localhost. Unsupported browsers can still use the preview interface. Browser storage or permissions may be cleared; failed persistence is explained in the connection panel. No folder contents or names are uploaded.

## Library folders

Choose a root folder arranged like this:

```text
Comic Library/
  Skybound Archive/
    Chapter 1.cbz
    Chapter 2.cbz
    Chapter 10.cbz
  Glass City/
    01.cbz
    02.CBZ
  Notes.txt
```

Only immediate subfolders containing direct `.cbz` files become series. Extensions are matched case-insensitively; series and chapters use locale-aware natural sorting. Chapter titles preserve filenames apart from the final extension. Root-level CBZ files, other file types, and deeper nested folders are ignored.

Scanning runs after selection, restoration with granted permission, reconnection, or **Rescan**. Inaccessible series folders are skipped with a partial-scan warning; failed scans can be retried. Changing or disconnecting folders cancels the previous scan and clears its results. Repeated Rescan clicks cannot start concurrent scans.

Scanning enumerates handles only: it does not read CBZ bytes, inspect ZIP entries, generate real covers, or open chapters. Covers are deterministic placeholders. Scan results remain in memory; only the selected root handle is stored in IndexedDB, and the library is rebuilt on connection. If IndexedDB fails, the current folder still works for the session. With no connected folder, sample comics are shown as previews.

## Reading CBZ chapters

The reader uses `@zip.js/zip.js` (the native-codec build) to process one chapter at a time, entirely inside the browser. A file is read only after selecting its chapter. Its ZIP directory is inspected first; image bytes are extracted sequentially only when page placeholders approach the viewport, using IntersectionObserver. Loaded pages remain in memory until the chapter closes. No archives, filenames, metadata, or images are uploaded or persisted in IndexedDB or the service-worker cache.

Supported page extensions are JPG, JPEG, PNG, WebP, GIF, and AVIF, case-insensitively. The browser must support decoding the image format. Images may be nested inside the archive and use the existing natural filename sorting, including their internal folder names. Directory entries, macOS metadata, named thumbnail folders/files, unsupported formats (including SVG), symbolic links, and absolute or traversal paths are ignored. Encrypted archives and compression formats other than stored/deflate are unsupported. Native deflate decompression requires a current compatible browser.

Safety limits are defined in `src/reader/archive-safety.ts`: at most **5,000 archive entries**, **2,000 image pages**, and **100 MiB uncompressed per image**. Declared sizes are checked before extraction; streamed output is also bounded. Invalid archives show a chapter error; individual extraction or image-decoding failures offer a page retry without clearing the other pages.

Zoom adjusts the maximum reader width from its default 720px; Fit width resets it, and images shrink to fit narrower screens while preserving their proportions. Back returns to the selected series; Library returns to the grid. Leaving the reader, opening another chapter, changing/disconnecting the folder, or destroying the reader aborts pending work, closes the ZIP reader, drops page references, and revokes all image object URLs. Stale loads cannot update a newer chapter. No next chapter is opened automatically, and reading positions are not saved yet.

## Production build

```bash
npm run build
npm run preview
```

## GitHub Pages

The repository is configured for the URL:

```text
https://YOUR-USERNAME.github.io/comic-reader/
```

In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the source. Pushing to `main` will run the included deployment workflow.

If you rename the repository, update `base`, `start_url`, and `scope` in `vite.config.ts`.

## Planned milestones

1. Application shell and PWA deployment
2. Read-only local folder selection
3. Library scanning and natural sorting
4. CBZ extraction and vertical reading
5. Seamless chapter transitions
6. Reading progress and preferences
