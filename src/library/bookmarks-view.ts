import type { ReadingData } from "../storage/reading-data";
import type { ReadingAnchor } from "../storage/bookmarks";
import type { ComicChapter, ComicSeries } from "./library-scanner";

export function initializeBookmarksView(
  data: ReadingData,
  libraryName: () => string | null,
  resolve: (seriesId: string, chapterId: string) => { series: ComicSeries; chapter: ComicChapter } | null,
  open: (series: ComicSeries, chapter: ComicChapter, anchor: ReadingAnchor) => void,
  notify: (message: string) => void,
) {
  const list = document.querySelector<HTMLElement>("#bookmark-list")!;
  const empty = document.querySelector<HTMLElement>("#bookmarks-empty")!;
  let signature = "";
  function render(): void {
    const name = libraryName();
    const bookmarks = name ? data.allBookmarks(name) : [];
    const entries = bookmarks.map(bookmark => ({ bookmark, target: resolve(bookmark.seriesId, bookmark.chapterId) }));
    const nextSignature = JSON.stringify(entries.map(e => [e.bookmark, Boolean(e.target)])) + name;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const focused = list.contains(document.activeElement);
      const rows = entries.map(({ bookmark, target }) => {
        const row = document.createElement("li"); row.className = "bookmark-row";
        const info = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = bookmark.seriesName;
        const location = document.createElement("p"); location.textContent = `${bookmark.chapterName} - Page ${bookmark.pageIndex + 1} of ${bookmark.pageCount}${target ? "" : " - Unavailable in the current scan"}`;
        info.append(title, location);
        const actions = document.createElement("div"); actions.className = "connection-actions";
        const openButton = document.createElement("button"); openButton.type = "button"; openButton.className = "button button-secondary";
        openButton.textContent = target ? "Open bookmark" : "Unavailable"; openButton.dataset.unavailable = String(!target);
        openButton.setAttribute("aria-label", `Open bookmark: ${bookmark.seriesName}, ${bookmark.chapterName}, page ${bookmark.pageIndex + 1}`);
        openButton.addEventListener("click", () => {
          const current = resolve(bookmark.seriesId, bookmark.chapterId);
          if (libraryName() === bookmark.libraryName && current) open(current.series, current.chapter, bookmark);
        });
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button-secondary";
        remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete bookmark: ${bookmark.seriesName}, ${bookmark.chapterName}, page ${bookmark.pageIndex + 1}`);
        remove.addEventListener("click", async () => {
          if (!data.available || data.busy) return;
          const hadFocus = document.activeElement === remove;
          try { await data.deleteBookmark(bookmark.id); notify("Bookmark deleted."); }
          catch (error) { notify(error instanceof Error ? error.message : "Bookmark could not be deleted."); }
          if (hadFocus) (list.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? document.querySelector<HTMLElement>("#bookmarks-title")!).focus();
        });
        actions.append(openButton, remove); row.append(info, actions); return row;
      });
      list.replaceChildren(...rows);
      if (focused) (list.querySelector<HTMLButtonElement>("button:not([data-unavailable=true])") ?? document.querySelector<HTMLElement>("#bookmarks-title")!).focus();
    }
    empty.hidden = bookmarks.length > 0;
    empty.textContent = !name ? "Connect a library to see its bookmarks." : "No bookmarks yet. Use Bookmark page in the reader.";
    for (const button of list.querySelectorAll<HTMLButtonElement>("button")) button.disabled = data.busy || (button.dataset.unavailable !== undefined ? button.dataset.unavailable === "true" : !data.available);
  }
  data.subscribe(render); render();
  return { render };
}
