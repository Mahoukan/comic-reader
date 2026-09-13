# Comic Reader project guidance

## Product

Comic Reader is a local-first, installable PWA for reading CBZ comic libraries. It is hosted as a static site on GitHub Pages. Comic files remain on the user's device and must never be uploaded.

## Architecture

- Use vanilla TypeScript, HTML, and CSS.
- Do not introduce a UI framework, router, backend, authentication, or remote database.
- Keep modules small and named by responsibility.
- Store device-local settings and progress in IndexedDB.
- Access comic folders read-only through the File System Access API.
- Treat all archive contents and filenames as untrusted input.
- Preserve the GitHub Pages base path `/comic-reader/`.

## Working style

- Implement one milestone at a time.
- Run `npm run build` before completing a change.
- Keep the interface responsive and keyboard accessible.
- Avoid loading an entire library or multiple large chapters into memory.
- Do not add features outside the current milestone.
