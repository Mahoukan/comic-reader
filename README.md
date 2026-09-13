# Comic Reader

Comic Reader is an installable, local-first PWA for reading CBZ libraries in vertical continuous scroll. Milestone 9 is complete. Milestone 10 is the final v1.0 release pass.

## Browser support and privacy

Local libraries require HTTPS or localhost and a browser providing the File System Access directory picker and persistent directory handles, such as compatible desktop Chrome or Edge. Many phone browsers do not provide this API: the phone reader layout does not bypass that limitation. Unsupported browsers show concise compatibility guidance.

All folder access is read-only. Comic files remain on the device and are never modified or uploaded. Extraction, decoding, resizing, progress, bookmarks, and cover caching happen locally. No accounts, analytics, external images, or metadata services are used. The service worker caches only the application's static assets, never comic files, page images, reading data, or generated covers.

Browser storage and permission can be cleared or revoked. The app checks saved read permission without prompting; use **Reconnect folder** to renew it. Permission is also checked when returning to the app and when file access fails. If storage is unavailable, reading, preferences, progress tracking, and bounded cover caching still work for the session, but bookmarks, manual state changes, and backups require working persistent storage.

## Connect a library

Choose a root folder arranged like this:

```text
Comic Library/
  Series Name/
    Chapter 1.cbz
    Chapter 2.cbz
    Chapter 10.cbz
```

Only immediate series subfolders with direct CBZ files are scanned. Extensions are case-insensitive; titles and chapter names use natural sorting. Root-level comics and deeper folders are ignored. Scanning enumerates handles without reading archive bytes. Use search, Title/Chapter count sorting, and **Rescan** to update the library after file changes. Partial scans identify unreadable folders and retain their cover cache; failed scans can be retried.

**Change folder** connects another root. **Disconnect folder** removes the saved connection separately from reading data. If storage fails during disconnect, the active session still disconnects, with an explanation that the earlier saved folder may restore next time. Changing/disconnecting folders cancels reading, scanning, and cover work.

## Read chapters

Open a series, then a chapter. Supported raster pages are JPG/JPEG, PNG, WebP, GIF, and AVIF where the browser can decode them. Nested image paths are naturally sorted. SVG, unsafe/traversal paths, symbolic links, macOS metadata, and named thumbnails are ignored. CBZ files must be unencrypted ZIP archives using stored or deflate compression with a compatible browser decoder.

Archive limits remain **5,000 entries**, **2,000 pages**, and **100 MiB uncompressed per image**, with declared and streamed size checks, CRC checks, and overlapping-entry checks. Pages extract sequentially near the viewport. Empty/corrupt/missing chapters and failed pages offer clear Retry and Back to series actions.

Automatic continuation prepares the next chapter near the current boundary. Disabling it leaves an explicit **Continue to next chapter** action. A failed next chapter leaves the current chapter readable and does not retry continuously. The toolbar and chapter selector follow the active chapter using the existing stable page tracking without moving keyboard focus while scrolling.

The resource window retains at most the previous, current, and next chapter. Evicted chapters and closed sessions release their archives, extraction queues, abort listeners, images, and object URLs. Generation guards prevent old results from changing a newer session. Layout changes above the reading area preserve its anchor.

**Previous chapter**, **Next chapter**, and the chapter selector open a fresh session at that chapter's top; Previous/Next are disabled at series boundaries. **Back to series** returns to the current chapter. **Fullscreen** is available where supported, never starts automatically, follows browser exits, and handles rejected requests without interrupting reading.

## Desktop and phone controls

Desktop controls retain explicit **Hide controls** and **Show controls** actions. Zoom adjusts the default 720px reading width from 60 to 140%; **Fit width** resets the saved desktop zoom to 100%.

At widths up to 700px, controls form a fixed bottom overlay that consumes no document layout space. Tap the reading area or scroll upward deliberately by about 24px to show them. Scrolling downward hides them; approximately three idle seconds also hides them when no control or dialog is in use. Dragging, scrolling, long presses, and text selection do not count as taps. A small **Show controls** button always provides a recovery action. Scroll handling is passive and runs through requestAnimationFrame.

The phone overlay includes active-page bookmarking, Previous/Next, chapter selection, **Reader settings**, and Back to series. Reader settings expands spacing, background, continuation, fullscreen, and shortcut help. Its height is bounded and its contents scroll on short screens. It respects safe-area insets and keeps touch targets at least 44px. Phone pages always fit the available width; zoom controls are hidden and this layout does not overwrite saved desktop zoom.

Reader background choices include **Black**, **OLED black**, **Dark**, and **Light**. OLED black uses true **#000**, including unloaded page surfaces, with readable controls, boundaries, errors, and focus indicators. Background, spacing, continuation, and desktop zoom use existing preference storage and backup validation. Clear reading data resets all preferences to their existing defaults.

Shortcuts outside inputs, selectors, editable content, and open dialogs:

| Key | Action |
| --- | --- |
| F | Toggle fullscreen |
| W | Fit width |
| B | Toggle active-page bookmark |
| H | Hide/show controls |
| [ / ] | Previous/next chapter |
| ? | Shortcut-help dialog |

Space, Page Up, Page Down, and arrow keys retain normal scrolling. Dialogs support Escape and focus restoration. Chapter changes and blocking errors use polite announcements; page tracking does not announce every page. Visible focus and reduced-motion support remain available.

## Reading data and backups

Continue Reading opens the latest saved position whose exact series/chapter identifiers exist in the current scan. Positions contain a page index and relative offset, with target-first image decoding and restoration. Scroll saves debounce for 700ms; chapter changes, leaving, visibility loss, and pagehide flush the latest anchor. Browser shutdown may interrupt an asynchronous final save.

Bookmarks use the active page's stable anchor. Bookmark lists restore positions and label missing chapters unavailable. Manual chapter/series read states are separate from progress; marking unread removes progress and overrides while retaining bookmarks. Completion counts only currently scanned chapters.

Settings **Export reading data** downloads local JSON schema version 1 containing only the active library's progress, bookmarks, manual read states, and global preferences. Covers, handles, files, and URLs are excluded. **Import reading data** validates one JSON file up to **5 MiB** and **10,000 total records**, then confirms replacement. Different library names require explicit confirmation; accepted imports remap the namespace but never guess renamed chapters. Replacement is transactional and cancels pending reader saves. Invalid or failed imports retain existing saved data.

**Clear reading data** confirms before clearing progress, bookmarks, read overrides, and preferences for this device. It retains the folder connection, cover cache, and comic files.

Native IndexedDB database `comic-reader` remains at **version 4**. Existing migrations are preserved: version 1 saves folder handles; version 2 adds progress/preferences; version 3 adds bookmarks/readStatuses; version 4 adds covers. Milestone 9 requires no database upgrade. Ordered writes and generation guards prevent stale saves from repopulating cleared data.

Library namespaces use the root folder's name. Two roots with exactly the same name share a namespace; renaming folders or chapters can leave stale records. Exact identifiers are required for restoration.

## Local series covers

Covers use the first naturally sorted supported raster image in the first naturally sorted chapter. Invalid first chapters retain deterministic initials and **Retry cover**, without searching later chapters. Only that page is extracted using the reader's archive safety rules.

Thumbnails preserve proportions inside **480 x 640px**, without upscaling or stored cropping. Decoded sources are limited to **16,384px per dimension** and **40 million pixels**. Canvas output prefers WebP at quality 0.82, with JPEG/PNG fallback and a **1 MiB** output limit. Card presentation uses a fixed 3:4 slot and object-fit: cover.

IntersectionObserver uses a **600px** preload margin and one deduplicated cover job at a time, prioritizing visible cards. The fallback viewport check is throttled. Only current search results request covers; a **24-thumbnail LRU** bounds session memory. Source validation uses chapter ID, filename, file size, and modification time; unchanged fingerprints reuse cached thumbnails without reopening the ZIP. Changes preserving every fingerprint field are not detected.

Only complete successful scans prune missing-series covers in the active namespace. **Clear cached covers** is separate from reading-data clearing: it cancels work, clears that library's thumbnails, revokes URLs, and regenerates nearby covers lazily. Archives, decoded bitmaps, canvases, and temporary URLs are released. Disposal removes card retry handlers, observers, listeners, and session cache references, including late-result guards.

## Milestone 9 manual checklist

- On a phone layout, tap pages, drag/scroll, scroll up/down, and wait three seconds; check the overlay and Show controls, safe areas, focus, selects, dialogs, and expanded Reader settings.
- Bookmark the active page with controls shown/hidden around chapter boundaries, then restore that bookmark.
- Set desktop zoom, resize to phone width, and return to desktop; verify phone fit-to-width and the unchanged saved zoom.
- Select OLED black, reload, export/import preferences, and clear reading data; check true-black surfaces and readable recovery/focus states.
- Change/disconnect folders during reading, scans, and cover generation; try unavailable storage during disconnect.
- Revoke permission, return to the app, and reconnect; check cancellation and the useful compatibility message in unsupported browsers.
- Switch chapters and navigate rapidly during opening/extraction/continuation; test empty/corrupt/missing chapters, Retry, fullscreen exit, and no stale images or unreleased resources.

No automated tests were added or run for this milestone. Validation uses only `npm.cmd run build` and `git diff --check`; application testing is manual.

## Installation and deployment

Install the PWA using the browser's install action where available. The static app shell is available offline after its assets are cached; comics still require local folder availability and read permission. Browser-cleared storage may remove saved connection, reading data, and covers.

GitHub Pages deployment uses the existing GitHub Actions workflow. The configured base path, manifest start URL, and scope remain **/comic-reader/**. Application icons and the static service-worker infrastructure are retained. Comic files and locally generated Blobs are never added to the service-worker cache.
