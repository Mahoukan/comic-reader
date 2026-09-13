# Comic Reader

Comic Reader **v1.0.0** is the first stable release: a local-first, installable PWA for reading CBZ comic libraries in vertical continuous scroll. Comics remain on your device and are never uploaded or modified.

## Features

- Read-only folder connection, natural sorting, search, series details, and lazy local covers.
- Continuous chapter reading with optional automatic continuation, Previous/Next, and chapter selection.
- Saved reading positions, Continue Reading, page bookmarks, and manual read states.
- Desktop zoom, phone fit-to-width, page spacing, OLED-black/dark/light backgrounds, fullscreen, and keyboard shortcuts.
- Accessible desktop Hide/Show controls and a phone overlay with tap/up-scroll reveal, down-scroll/idle hiding, safe areas, and a permanent Show controls recovery action.
- Local JSON backup/import, separate reading-data and cover-cache clearing, optional installation, and user-controlled app updates.

## Browsers and library setup

Use **Chrome or Edge on desktop**, on HTTPS or localhost, for persistent folder access. The browser must provide the File System Access directory picker and directory handles. Many phone browsers do not support this API; the responsive phone reader does not bypass that limitation. Unsupported browsers show compatibility guidance.

Choose the parent folder containing one folder per series, with CBZ chapters directly inside each series folder:

```text
Comics/
  Series One/
    Chapter 1.cbz
    Chapter 2.cbz
  Series Two/
    Volume 1.cbz
```

Click **Choose folder** to grant read-only access. Saved permission is queried without prompting; click **Reconnect folder** when permission needs renewal. **Change folder** selects a different root. **Rescan** refreshes the library after changes; root-level comics and deeper nested series folders are ignored. Partial scans report unreadable folders and can be retried.

Open a series and chapter to read, or use Continue Reading or a saved bookmark. Previous/Next and chapter selection start at the chapter's top. Automatic continuation prepares the next chapter near the current boundary; failed continuation leaves the current chapter readable with Retry and Back actions.

Desktop zoom is saved from 60 to 140%; Fit width resets the default 720px reading width. Phone pages fit the available width without changing desktop zoom. Tap the reading area or scroll upward about 24px to reveal phone controls. Downward scrolling and roughly three idle seconds hide them when controls/dialogs are not being used. Reader settings expands spacing, background, continuation, fullscreen, and help. Keyboard shortcuts outside fields/editable content/dialogs: **F** fullscreen, **W** Fit width, **B** bookmark, **H** controls, **[**/**]** chapters, **?** help. Normal scrolling keys remain unchanged.

## Installation, offline use, and updates

Settings shows **Install Comic Reader** only when the browser supplies an installation prompt. Installation is optional; cancellation is quiet and does not produce repeated prompts in that tab. The action disappears after installation or in standalone mode. The app works in a normal browser tab too. Installed windows use standalone display and prefer portrait orientation.

After its assets are cached, the app shell can open offline. Comics still require the local folder to be available and read permission to be granted. Installation/offline setup failures leave normal browser reading available.

When a new app version is waiting, an accessible notice offers **Update now** and **Later**. Later dismisses the notice for the tab; Settings retains Update now while an update is available. Nothing forces a reload during reading. Update now activates the waiting worker and reloads only when it is ready, after capturing the reading position, closing reader resources, and flushing pending metadata writes. An update activated in another tab still requires this tab's consent to reload. Failed or timed-out activation leaves reading available and offers retry. Outdated app-shell caches are cleaned up during activation.

## Privacy and local storage

Folder access, archive extraction, image decoding, thumbnail resizing, and all reading data stay on the device. There are no analytics, tracking, ads, remote fonts, or external comic/metadata requests. The static application and bundled assets are the only service-worker cache contents. Comic bytes, image/object URLs, handles, generated cover Blobs, and reading data never enter that cache.

Native IndexedDB database `comic-reader` remains at **version 4**, preserving all existing migrations and stores: folder handles, progress, preferences, bookmarks, manual read states, and disposable cover thumbnails. If storage fails, reading, preferences, progress tracking, and a bounded cover cache work for the session; bookmarks, manual states, and backups require persistent storage. Browser-cleared storage may remove all saved local data. Final asynchronous saves can be interrupted by browser shutdown.

**Disconnect folder** retains reading data and comics. If storage fails while disconnecting, the session still disconnects with a warning that the saved folder may restore next time. **Clear reading data** confirms before removing this device's progress, bookmarks, states, and preferences, retaining the connection and covers. **Clear cached covers** clears only the active library's disposable covers and regenerates nearby thumbnails lazily.

Covers use the first naturally sorted supported raster image in the first naturally sorted chapter. Invalid sources keep initials and Retry cover without searching later chapters. Thumbnails preserve proportions within **480 x 640px**, without upscaling or stored cropping, preferring WebP quality 0.82 with JPEG/PNG fallback and a **1 MiB** limit. Generation has one job at a time, a **600px** preload margin, and a **24-thumbnail** session cache. Chapter ID/filename, file size, and modification time validate reuse; complete scans prune missing-series covers, while partial/failed scans retain them.

## Backup and import

1. Connect the library and open Settings.
2. Choose **Export reading data** to download local JSON containing that library's progress, bookmarks, read states, and global reader preferences.
3. To restore, choose **Import reading data**, select one backup, review its library name and record counts, and confirm replacement. A different library name requires additional confirmation.

Import replaces the active library's saved metadata transactionally, preserving other library-name namespaces and the folder connection. Invalid or failed imports retain saved data. Schema version 1 accepts at most **5 MiB** and **10,000 total records**. Backups exclude comic files, handles, images, covers, and URLs. Renamed series/chapters are never guessed.

## Known limitations

- One connected folder at a time; root-level CBZ files and deeper series folders are not scanned.
- Only unencrypted CBZ ZIP archives using stored/deflate compression; raster pages are JPG/JPEG, PNG, WebP, GIF, and AVIF where browser decoding is available. SVG, unsafe paths, symlinks, macOS metadata, and named thumbnails are ignored.
- Archive limits: **5,000 entries**, **2,000 pages**, and **100 MiB uncompressed per page**, with bounded extraction, CRC, and overlap checks. Cover decoding additionally limits sources to **16,384px per dimension** and **40 million pixels**.
- The reader retains the previous/current/next chapter window. Older evicted chapters are reopened using chapter navigation rather than scrolling indefinitely backward.
- File changes require Rescan. Cover changes preserving the whole fingerprint are not detected.
- Root folder names define storage namespaces; two roots with identical names share a namespace. Renaming folders/files can leave unavailable progress or bookmarks.
- Persistent folder access, fullscreen, installation, and raster formats depend on browser capabilities and permission. Phone layout support does not imply phone directory-picker support.

## Local development

Use Node.js **22.12 or newer** (the deployment workflow uses Node.js 24) and npm.

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run build
npm.cmd run preview
```

Open the local URL printed by Vite, including `/comic-reader/`. The production build is written to `dist/`. There is no backend or server-side router.

## GitHub Pages deployment

The Vite base, manifest ID/start URL/scope, icons, and service-worker scope use **/comic-reader/**. The site is served at `https://YOUR-USERNAME.github.io/comic-reader/`. Direct loading/reloading of the root or `index.html` uses static files, with the service-worker navigation fallback limited to those app-shell paths. Only generated `dist/` assets are uploaded; source, documentation, development configuration, and local comic data are not deployed.

In the GitHub repository, set **Settings > Pages > Build and deployment > Source** to **GitHub Actions**. Under **Settings > Actions > General**, enable Actions and allow the official actions used by the workflow; check that any **github-pages** environment protection rules permit the intended deployment. Organization policy must allow the workflow's `contents: read`, `pages: write`, and `id-token: write` permissions. Use the repository name `comic-reader` and leave Pages custom-domain settings unset unless deliberately reconfiguring the base path.

The existing `.github/workflows/deploy.yml` checks out the project, installs the lockfile with `npm ci`, builds with Node.js 24, uploads `dist/` as the Pages artifact, and deploys through the `github-pages` environment. Once manually verified, the user can commit/push to `main` or run the workflow manually. Release preparation itself does not publish a site, GitHub release, or tag.

## Final manual release checklist

- Start without a saved connection; verify folder guidance, Choose folder, empty folders, unsupported-browser messaging, denied/revoked permission, and reconnect/change/disconnect recovery.
- Scan/search/sort a real library, check cached covers and Retry/clear, read across chapter boundaries, restore progress/bookmarks, and mark chapters/series read or unread.
- Switch chapters and folders rapidly during extraction; try corrupt/empty/missing files and failed pages/continuation, and verify no stale images or unreleased resources.
- Check desktop controls/zoom, phone tap/up/down/idle overlay behavior, active-page bookmarks, phone fit-to-width, OLED black, safe areas, keyboard shortcuts, focus, and reduced motion.
- Export/import a backup, cancel or reject an invalid import, and verify clear actions affect only their documented data.
- Check install availability/cancellation/standalone behavior and offline reopening. Try Update now/Later during reading, activation failure, and an update from another tab; confirm reload occurs only after consent and readiness.
- On GitHub Pages, directly open/reload `/comic-reader/` and `/comic-reader/index.html`; verify the manifest, icons, bundled JS/CSS, and worker resolve under the repository path, with no comic uploads or comic data in service-worker caches.

Release preparation validation uses `npm.cmd run build` and `git diff --check`, plus inspection of generated artifacts. No automated tests or fixtures were added or run.
