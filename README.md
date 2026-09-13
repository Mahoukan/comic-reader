# Comic Reader

An installable, offline-first web reader for local CBZ comic libraries.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. Milestone 6A is complete: the vertical reader remembers page positions, offers real Continue Reading, derives chapter/series reading states, and saves supported reader preferences. The library supports natural sorting, search, chapter counts, and series detail lists.

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

Scanning enumerates handles only: it does not read CBZ bytes, inspect ZIP entries, generate real covers, or open chapters. Covers are deterministic placeholders. Scan results remain in memory; the selected root handle, reading progress, and reader preferences are stored in IndexedDB, and the library is rebuilt on connection. If IndexedDB fails, the current folder still works for the session. With no connected folder, sample comics are shown as previews.

## Reading CBZ chapters

The reader uses `@zip.js/zip.js` (the native-codec build) to process a small chapter window, entirely inside the browser. Selecting a chapter starts a fresh reading session at that chapter. ZIP directories are inspected first; image bytes are extracted sequentially only when page placeholders approach the viewport, using IntersectionObserver and one shared session queue. No archives or images are uploaded or persisted in IndexedDB or the service-worker cache. Only the progress metadata described below is saved locally.

Supported page extensions are JPG, JPEG, PNG, WebP, GIF, and AVIF, case-insensitively. The browser must support decoding the image format. Images may be nested inside the archive and use the existing natural filename sorting, including their internal folder names. Directory entries, macOS metadata, named thumbnail folders/files, unsupported formats (including SVG), symbolic links, and absolute or traversal paths are ignored. Encrypted archives and compression formats other than stored/deflate are unsupported. Native deflate decompression requires a current compatible browser.

Safety limits are defined in `src/reader/archive-safety.ts`: at most **5,000 archive entries**, **2,000 image pages**, and **100 MiB uncompressed per image**. Declared sizes are checked before extraction; streamed output is also bounded. Invalid archives show a chapter error; individual extraction or image-decoding failures offer a page retry without clearing the other pages.

Zoom adjusts the maximum reader width from its default 720px; Fit width resets it, and images shrink to fit narrower screens while preserving their proportions. Back returns to the currently visible chapter in its series; Library returns to the grid. Leaving the reader, selecting another chapter, changing/disconnecting the folder, or losing folder permission aborts the whole session, closes every archive, removes chapter sections, and revokes all image object URLs. Stale loads cannot update a newer session. The latest reading anchor is captured before cleanup.

## Chapter continuation

Automatic continuation defaults to enabled. An end sentinel prepares the next chapter's ZIP directory roughly one to two viewport heights before the boundary; it appends placeholders once, without eagerly extracting its images. A compact `End of [chapter]` / `[next chapter]` divider lets scrolling continue naturally. Pending preparation shows a loading message at the boundary. The Reader toggle and Settings **Automatically continue** control stay in sync and persist across reloads; disabling continuation gives unprepared boundaries a **Continue to next chapter** button. Already-mounted chapters remain intact.

The toolbar follows the page nearest the upper-middle reading area. An 80px dead band stabilises chapter changes at boundaries. Page changes are not announced; chapter changes and blocking errors use a polite live region without moving focus. The final chapter shows **End of series** and never attempts another load.

The resource window retains at most the immediately previous chapter, the current chapter, and its next chapter. Advancing releases older ZIP readers, extraction jobs, image URLs, and page DOM. The reading anchor is measured before and after removing content above the viewport, and scrolling is compensated immediately. Late image decoding above the reading area uses the same approach. You can scroll backwards across the most recent retained boundary, but older chapters and chapters before the session's starting point are not loaded backwards. A deliberate backward crossing may release a prepared chapter farther ahead, which is reopened if you advance to it later.

If the next chapter fails, the completed chapter remains readable and the failed section shows its name, **Retry chapter**, and **Back to series**. Observer events do not retry or skip it automatically. Folder permission errors use the existing reconnection flow when permission is actually lost. Progress and derived completion are saved locally; bookmarks and manual reading-state controls remain deferred.

## Saved reading data (Milestone 6A)

Native IndexedDB database `comic-reader` upgrades from version 1 to version 2 by creating `progress` and `preferences` stores. The existing `library` store and its saved directory handle remain untouched. **Clear reading data** confirms before clearing only the two new stores, resetting preferences and derived states immediately. **Disconnect folder** removes the connection separately and retains reading data.

Each chapter progress record contains `libraryName`, `seriesId`, `seriesName`, `chapterId`, `chapterName`, zero-based `pageIndex`, known `pageCount`, `offsetRatio` (0?1), `completed`, and `updatedAt`. It contains no absolute paths, handles, ZIP entries, file bytes, Blobs, or image URLs. Its key is the JSON tuple `[libraryName, seriesId, chapterId]`, using the scanner's deterministic identifiers. Two different root folders with exactly the same name share this namespace in this first version. Renaming a root, series, or chapter can leave stale progress; no similarly named chapter is guessed.

The anchor is the page nearest the upper-middle reading line, with its relative vertical offset. Meaningful changes save after a 700ms scroll debounce, chapter crossings flush, and leaving the reader, hiding the page, or `pagehide` captures and flushes the latest anchor before resource cleanup. Browser shutdown may interrupt asynchronous IndexedDB writes; recent debounced saves provide a fallback. A serialized write queue and clear-generation guard prevent earlier queued writes from repopulating cleared data. Session generation checks and cancellation prevent old extraction/restoration callbacks from updating or scrolling a newer session. Preferences use the same ordered queue with a 300ms debounce.

Continue Reading uses the newest record whose exact series/chapter IDs exist in the current completed scan. The real panel stays hidden during scanning or when no valid record exists. Restoration starts a fresh session at the saved chapter, loads its saved page first, clamps an index if the page count changed, and scrolls immediately to the relative offset after image decoding. Earlier chapters are not mounted. A failed page retains a positioned placeholder and Retry with a polite warning. A missing or renamed chapter is ignored after rescan; other library entries stay available. Position changes caused by decoding earlier pages retain the reading anchor.

Opening a chapter records **Reading**, without completing it. Crossing forward into the next chapter completes the departing chapter. The final chapter completes when its end marker fits meaningfully inside the usable viewport. Completion remains recorded until reading data is cleared. Series states use only currently scanned chapters: **Unread** has no valid records; **Reading** has progress without all chapters completed; **Completed** requires completed records for every scanned chapter. The displayed percentage is rounded: `(completed chapter count + latest incomplete chapter fraction) / scanned chapter count ? 100`, where the fraction is `(pageIndex + offsetRatio) / pageCount`. It is an approximate reading indicator, not elapsed reading time.

Global reader preferences persist across series and reloads: automatic continuation (default on), zoom (60?140%, default 100%), page spacing (none/0px, small/8px, medium/24px, large/48px), and background (black/default, dark, light). Settings and reader controls stay synchronized, changes apply immediately, and Fit width saves 100%. Invalid or obsolete stored values fall back to defaults. Unsupported reading modes and directions are absent.

If IndexedDB is unavailable or a write fails, a single persistent warning explains that progress cannot be saved. The reader and preferences continue in memory for the current session. Folder storage errors still use the existing connection messages. All data stays on the device; progress never enters URLs or network requests, and source comics remain read-only.

### Manual verification checklist

- Read the middle of a page, leave via Back/Library/Settings, and Continue; reload and reconnect, then Continue again.
- Cross chapter boundaries and reach the final end marker; check chapter rows and Completed/100% only after all chapters complete.
- Change all preferences, reload, switch series, and use Fit width; verify visible spacing/background and synchronized controls.
- Select chapters rapidly during loading or a pending save; disconnect/reconnect; verify the newest session and retained progress.
- Clear reading data immediately after scrolling/changing preferences; wait past both debounces, reload, and verify defaults, no real Continue panel, and the retained connection.
- Rename/remove a saved chapter and rescan; replace a CBZ with fewer pages; test a damaged saved page and Retry.
- Disable IndexedDB and verify one warning, working reading, and session preferences. Upgrade a version-1 database and verify the saved handle survives.
- Use keyboard focus and dialog Cancel/Escape, a narrow mobile viewport, reduced motion, and light background; inspect contrast and page position.
- Check for uncaught exceptions, released object URLs after leaving, and no comic/progress network traffic.

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
6A. Reading progress and preferences (complete)
6B. Bookmarks, manual read states, and data export/import (next)
