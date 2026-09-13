# Comic Reader

An installable, offline-first web reader for local CBZ comic libraries.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. Milestone 6B is complete: bookmarks, manual read states, and local JSON backup/restore are available. Milestone 6A added: the vertical reader remembers page positions, offers real Continue Reading, derives chapter/series reading states, and saves supported reader preferences. The library supports natural sorting, search, chapter counts, and series detail lists.

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

If the next chapter fails, the completed chapter remains readable and the failed section shows its name, **Retry chapter**, and **Back to series**. Observer events do not retry or skip it automatically. Folder permission errors use the existing reconnection flow when permission is actually lost. Progress and derived completion are saved locally; bookmarks and manual reading-state controls are described below.

## Saved reading data (Milestone 6A)

Native IndexedDB database `comic-reader` upgrades from version 1 to version 2 by creating `progress` and `preferences` stores. Version 3 adds `bookmarks` and `readStatuses` without changing existing folder handles, progress, or preferences. **Clear reading data** confirms before clearing all four metadata stores, resetting preferences and derived states after the transaction commits. **Disconnect folder** removes the connection separately and retains reading data.

Each chapter progress record contains `libraryName`, `seriesId`, `seriesName`, `chapterId`, `chapterName`, zero-based `pageIndex`, known `pageCount`, `offsetRatio` (0 to 1), `completed`, and `updatedAt`. It contains no absolute paths, handles, ZIP entries, file bytes, Blobs, or image URLs. Its key is the JSON tuple `[libraryName, seriesId, chapterId]`, using the scanner's deterministic identifiers. Two different root folders with exactly the same name share this namespace in this first version. Renaming a root, series, or chapter can leave stale progress; no similarly named chapter is guessed.

The anchor is the page nearest the upper-middle reading line, with its relative vertical offset. Meaningful changes save after a 700ms scroll debounce, chapter crossings flush, and leaving the reader, hiding the page, or `pagehide` captures and flushes the latest anchor before resource cleanup. Browser shutdown may interrupt asynchronous IndexedDB writes; recent debounced saves provide a fallback. A serialized write queue and clear-generation guard prevent earlier queued writes from repopulating cleared data. Session generation checks and cancellation prevent old extraction/restoration callbacks from updating or scrolling a newer session. Preferences use the same ordered queue with a 300ms debounce.

Continue Reading uses the newest record whose exact series/chapter IDs exist in the current completed scan. The real panel stays hidden during scanning or when no valid record exists. Restoration starts a fresh session at the saved chapter, loads its saved page first, clamps an index if the page count changed, and scrolls immediately to the relative offset after image decoding. Earlier chapters are not mounted. A failed page retains a positioned placeholder and Retry with a polite warning. A missing or renamed chapter is ignored after rescan; other library entries stay available. Position changes caused by decoding earlier pages retain the reading anchor.

Opening a chapter records **Reading**, without completing it. Crossing forward into the next chapter completes the departing chapter. The final chapter completes when its end marker fits meaningfully inside the usable viewport. Completion remains recorded until the chapter/series is explicitly marked unread or reading data is cleared. Series states use only currently scanned chapters: **Unread** has neither valid progress nor read overrides; **Reading** has progress or some read chapters without all chapters read; **Completed** requires every scanned chapter to be automatically completed or manually read. The displayed percentage is rounded: `(read chapter count + latest incomplete, non-overridden chapter fraction) / scanned chapter count * 100`, where the fraction is `(pageIndex + offsetRatio) / pageCount`. It is an approximate reading indicator, not elapsed reading time.

Global reader preferences persist across series and reloads: automatic continuation (default on), zoom (60 to 140%, default 100%), page spacing (none/0px, small/8px, medium/24px, large/48px), and background (black/default, dark, light). Settings and reader controls stay synchronized, changes apply immediately, and Fit width saves 100%. Invalid or obsolete stored values fall back to defaults. Unsupported reading modes and directions are absent.

If IndexedDB is unavailable or a write fails, a single persistent warning explains that progress cannot be saved. The reader and preferences continue in memory for the current session. Bookmark changes, manual state changes, clearing, and backup actions are disabled with an explanation when persistent storage is unavailable. Folder storage errors still use the existing connection messages. All data stays on the device; progress never enters URLs or network requests, and source comics remain read-only.

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

## Bookmarks and manual states (Milestone 6B)

**Bookmark page** in the reader toggles one bookmark per page at the same stable reading anchor used for progress. Its pressed state follows the current page, and it becomes available only when a valid page and working storage exist. Bookmarks save the library/series/chapter names and IDs, page index/count, relative offset, and creation/update timestamps. Their deterministic ID is `[libraryName, seriesId, chapterId, pageIndex]` encoded as JSON. Bookmarking preserves keyboard focus and scrolling.

Desktop and mobile **Bookmarks** navigation lists the connected library's bookmarks newest first. **Open bookmark** uses the existing target-first, decode-corrected restoration path, starting at that chapter without mounting preceding chapters. Missing or renamed chapters are labelled unavailable and remain deletable. Names are rendered as text, including imported names. Changing sessions cancels stale bookmark restores.

Chapter rows provide separate Open, **Mark read**, and **Mark unread** actions. A chapter is **Read** if its progress is automatically completed or it has a manual `read` override; otherwise incomplete progress means **Reading**, and no record means **Unread**. Mark read stores a separate override with library name, series/chapter IDs, and timestamp. It neither fabricates progress nor opens a file. Opening a manually read chapter preserves its read state.

Mark unread removes the chapter's progress and manual override and invalidates its delayed saves. **Bookmarks survive marking a chapter or series unread.** Confirmed **Mark series read** sets overrides for currently scanned chapters in one transaction, retaining progress and bookmarks. Confirmed **Mark series unread** removes all progress and overrides for that series, retaining bookmarks and updating Continue Reading. Centralized completion counts only chapters in the current scan, so disappeared chapters do not count toward the total. These actions never modify source comics.

## Local JSON backup and restore

Settings **Export reading data** downloads a locally generated file named `comic-reader-backup-YYYY-MM-DD.json`. Schema version 1 has this explicit outer structure:

```json
{
  "application": "comic-reader",
  "schemaVersion": 1,
  "exportedAt": "2026-09-13T00:00:00.000Z",
  "libraryName": "Comic Library",
  "progress": [],
  "bookmarks": [],
  "readStatuses": [],
  "preferences": {
    "automaticContinuation": true,
    "zoom": 100,
    "spacing": "none",
    "background": "black"
  }
}
```

Only the active library's metadata and global reader preferences are exported. Explicit field projections exclude handles, permission data, absolute paths, ZIP entries, CBZ contents, images, Blobs, and object URLs. The temporary download Blob URL is revoked after use. The JSON file is not uploaded or cached by the service worker.

**Import reading data** requires a connected library and working IndexedDB. Choose one JSON file, at most **5 MiB**, with at most **10,000 total records** across progress, bookmarks, and statuses. Export uses the same limits. Validation checks the application/schema, exact supported fields, timestamps, bounded metadata strings (2,048 characters, without control characters or absolute-path prefixes), bookmark identities, record ownership, duplicates, page counts (1 to 2,000), integer page indexes, and all preference values. Finite offsets and zoom are clamped to supported ranges; page indexes are clamped to the stored page count. Unsupported, malformed, extra-field, duplicate, or oversized backups are rejected before any data changes.

A confirmation shows both library names and the record counts. Cancel leaves existing data unchanged. Different library names require an additional explicit checkbox confirmation. Accepted mismatches remap the records' library namespace and bookmark IDs to the connected root name; exact series/chapter identifiers still determine availability. Renamed chapters are never guessed. Same-named roots remain indistinguishable as documented above.

Import **replaces**, rather than merges, progress, bookmarks, and manual statuses for the active library and applies global preferences. The folder connection and metadata for other root names remain untouched. Replacement uses one IndexedDB transaction, with in-memory changes published only after commit. Failure aborts the transaction and retains previous data. Import ends the active reader, cancels its pending anchor and preference writes, invalidates old write generations, and returns to Settings before replacing metadata. All views refresh after success.

**Clear reading data** now removes progress, bookmarks, manual read overrides, and stored preferences for this device. It cancels pending writes, resets defaults, and leaves the selected folder connected and every comic unchanged. Disconnecting remains a separate action and preserves reading metadata.

### Milestone 6B manual checklist

- Toggle bookmarks, move between pages, restart/reconnect, restore an offset, delete a bookmark, and remove its chapter to check unavailable handling.
- Mark a chapter and series read/unread; open a manually read chapter; verify bookmarks survive and pending saves do not recreate unread progress.
- Export and inspect the JSON; clear and import it; verify progress, bookmarks, states, preferences, and the retained folder connection.
- Try malformed JSON, unsupported versions, oversized/count-limit files, invalid records/preferences, duplicates, and extra fields; verify no replacement.
- Cancel import, then test a different library name and its additional confirmation. Import during pending reader work and verify old callbacks cannot overwrite or scroll the restored session.
- Test unavailable IndexedDB, mobile four-item navigation, keyboard Space/Tab/Escape, independent chapter actions, dialog focus, no uncaught exceptions, and revoked image/download URLs.

Milestone 6B is complete. The next milestone is real cover extraction and library visual polish.

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
6B. Bookmarks, manual read states, and data export/import (complete)
7. Real cover extraction and library visual polish (next)
