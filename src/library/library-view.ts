import { initializeCoverView } from "./cover-view";
import type { ReadingData } from "../storage/reading-data";
import type { ReadingProgress } from "../storage/reading-progress";
import type { ReadingAnchor } from "../storage/bookmarks";
import { chapterState, seriesProgress } from "../storage/reading-status";
import type { LibraryConnection } from "./connection";
import { checkFolderAvailable, checkReadPermission } from "./folder-access";
import { scanLibrary, type ComicChapter, type ComicSeries, type LibraryScan } from "./library-scanner";
import { naturalCompare } from "./natural-sort";

const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;

export function initializeLibraryView(
  reportAccessFailure: (root: FileSystemDirectoryHandle, error: unknown) => Promise<void>,
  openChapter: (series: ComicSeries, chapter: ComicChapter, position?: ReadingAnchor) => void,
  data: ReadingData,
  notify: (message: string) => void,
): { setVisible: (visible: boolean) => void; destroy: () => void; resolveChapter: (seriesId: string, chapterId: string) => { series: ComicSeries; chapter: ComicChapter } | null; subscribeScan: (listener: () => void) => void; updateConnection: (connection: LibraryConnection) => void; resetDetail: () => void; returnToSeries: (series: ComicSeries, chapter: ComicChapter) => void } {
  const grid = document.querySelector<HTMLDivElement>("#comic-grid")!;
  const search = document.querySelector<HTMLInputElement>("#library-search")!;
  const sort = document.querySelector<HTMLSelectElement>("#library-sort")!;
  const visibleCount = document.querySelector<HTMLElement>("#series-count")!;
  const emptySearch = document.querySelector<HTMLElement>("#empty-message")!;
  const heading = document.querySelector<HTMLElement>("#series-heading")!;
  const subtitle = document.querySelector<HTMLElement>("#library-subtitle")!;
  const status = document.querySelector<HTMLElement>("#scan-status")!;
  const overview = document.querySelector<HTMLElement>("#library-overview")!;
  const detail = document.querySelector<HTMLElement>("#series-detail")!;
  const detailTitle = document.querySelector<HTMLElement>("#series-title")!;
  const detailCount = document.querySelector<HTMLElement>("#chapter-count")!;
  const chapterList = document.querySelector<HTMLOListElement>("#chapter-list")!;
  const continuePanel = document.querySelector<HTMLElement>(".continue-panel")!;
  const rescanButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-library-rescan]"));
  let connection: LibraryConnection = { state: "disconnected", handle: null, revision: 0, busy: false };
  let root: FileSystemDirectoryHandle | null = null;
  let revision = -1;
  let generation = 0;
  let abort: AbortController | null = null;
  let scanning = false;
  let result: LibraryScan | null = null;
  const scanListeners = new Set<() => void>();
  let detailSeries: ComicSeries | null = null;
  let continuation: { series: ComicSeries; chapter: ComicChapter; record: ReadingProgress } | null = null;
  let returnCard: HTMLButtonElement | null = null;
  let viewVisible = true;
  const covers = initializeCoverView(notify);
  const subscriptions: (() => void)[] = [];
  const lifetime = new AbortController();
  let destroyed = false;

  function resetDetail(restoreFocus = false): void {
    const wasOpen = !detail.hidden;
    detail.hidden = true;
    overview.hidden = false;
    covers.setVisible(viewVisible);
    detailSeries = null;
    chapterList.replaceChildren();
    detailTitle.textContent = "";
    detailCount.textContent = "";
    if (wasOpen && restoreFocus) (returnCard?.isConnected ? returnCard : search).focus();
    returnCard = null;
  }

  function openSeries(series: ComicSeries, card: HTMLButtonElement | null): void {
    detailSeries = series;
    returnCard = card;
    overview.hidden = true;
    covers.setVisible(false);
    detail.hidden = false;
    detailTitle.textContent = series.name;
    detailCount.textContent = count(series.chapters.length, "chapter");
    const rows = series.chapters.map(chapter => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-button";
      button.textContent = chapter.displayName;
      const state = document.createElement("span"); state.className = "chapter-state"; button.append(state);
      button.dataset.chapterId = chapter.id;
      button.addEventListener("click", () => openChapter(series, chapter));
      const actions = document.createElement("div"); actions.className = "chapter-actions";
      for (const [label, read] of [["Mark read", true], ["Mark unread", false]] as const) {
        const action = document.createElement("button"); action.type = "button"; action.className = "button button-secondary";
        action.textContent = label; action.dataset.readAction = String(read);
        action.setAttribute("aria-label", `${label}: ${chapter.displayName}`);
        action.addEventListener("click", async () => {
          if (!root || !data.available || data.busy) return;
          try { await data.markChapters(root.name, series.id, [chapter.id], read); notify(read ? "Chapter marked read." : "Chapter marked unread. Bookmarks retained."); }
          catch (error) { notify(error instanceof Error ? error.message : "Reading state could not be changed."); }
          if (action.hidden) (actions.querySelector<HTMLButtonElement>("button:not([hidden])") ?? button).focus();
        });
        actions.append(action);
      }
      row.dataset.rowChapterId = chapter.id;
      row.append(button, actions);
      return row;
    });
    chapterList.replaceChildren(...rows);
    refreshProgress();
    detailTitle.focus();
  }

  function realCard(series: ComicSeries): HTMLElement {
    const card = document.createElement("article");
    card.className = "comic-card real-comic-card";
    const open = document.createElement("button"); open.type = "button"; open.className = "series-open";
    open.setAttribute("aria-label", `Open series: ${series.name}`);
    card.dataset.seriesId = series.id;
    const cover = document.createElement("span");
    // Deterministic palette selection, independent of scan order.
    let hash = 0;
    for (const character of series.name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
    cover.className = `cover-placeholder ${["cover-one", "cover-two", "cover-three", "cover-four"][hash % 4]}`;
    cover.setAttribute("aria-hidden", "true");
    const initials = document.createElement("span");
    initials.textContent = series.name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] ?? "").join("").toLocaleUpperCase() || "CB";
    cover.append(initials);
    const title = document.createElement("strong");
    title.textContent = series.name;
    const chapters = document.createElement("span");
    chapters.textContent = count(series.chapters.length, "chapter");
    const progress = document.createElement("span"); progress.className = "series-progress";
    open.append(cover, title, chapters, progress);
    const coverStatus = document.createElement("span"); coverStatus.className = "cover-status";
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "cover-retry button button-secondary";
    retry.textContent = "Retry cover"; retry.setAttribute("aria-label", `Retry cover: ${series.name}`); retry.hidden = true;
    card.append(open, coverStatus, retry);
    open.addEventListener("click", () => openSeries(series, open));
    return card;
  }

  function renderLibrary(): void {
    const query = search.value.trim().toLocaleLowerCase();
    subtitle.textContent = root ? "Your local series - Choose a series and chapter to read." : "Choose a local folder to start reading.";
    heading.textContent = "All series";
    const series = [...(result?.series ?? [])];
    const total = series.length;
    series.sort((a, b) => sort.value === "chapters"
      ? b.chapters.length - a.chapters.length || naturalCompare(a.name, b.name)
      : naturalCompare(a.name, b.name));
    const filtered = series.filter(item => item.name.toLocaleLowerCase().includes(query));
    const visible = filtered.length;
    covers.bind([], grid);
    grid.replaceChildren(...filtered.map(realCard));
    covers.bind(filtered, grid);
    search.disabled = sort.disabled = !root || scanning;
    visibleCount.textContent = query ? `${visible} of ${total} series` : `${total} series`;
    emptySearch.hidden = visible !== 0 || total === 0;
    emptySearch.textContent = "No series match your search. Try another name or clear the search.";
    const summary = root ? result ? `${result.series.length} series - ${count(result.chapterCount, "chapter")}` : "Library not scanned yet" : "No library connected";
    document.querySelectorAll<HTMLElement>("[data-library-summary]").forEach(element => element.textContent = summary);
    refreshProgress();
    scanListeners.forEach(listener => listener());
  }

  function refreshProgress(): void {
    const records = root ? data.all(root.name) : [];
    continuation = null;
    document.querySelectorAll<HTMLButtonElement>("[data-series-read]").forEach(b => b.disabled = !root || !detailSeries || !data.available || data.busy);
    if (root && result) {
      for (const record of [...records].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const series = result.series.find(s => s.id === record.seriesId);
        const chapter = series?.chapters.find(c => c.id === record.chapterId);
        if (series && chapter) { continuation = { series, chapter, record }; break; }
      }
      for (const card of grid.querySelectorAll<HTMLElement>("[data-series-id]")) {
        const series = result.series.find(s => s.id === card.dataset.seriesId)!;
        const progress = seriesProgress(series, records, data.allStatuses(root.name));
        card.querySelector<HTMLElement>(".series-progress")!.textContent = `${progress.state} \u00b7 ${progress.percent}%`;
      }
      if (detailSeries) {
        const statuses = data.allStatuses(root.name).filter(r => r.seriesId === detailSeries!.id);
        const progress = records.filter(r => r.seriesId === detailSeries!.id);
        const summary = seriesProgress(detailSeries, records, statuses);
        detailCount.textContent = `${count(detailSeries.chapters.length, "chapter")} \u00b7 ${summary.state} \u00b7 ${summary.percent}%`;
        for (const row of chapterList.querySelectorAll<HTMLElement>("[data-row-chapter-id]")) {
          const state = chapterState(row.dataset.rowChapterId!, progress, statuses);
          row.querySelector<HTMLElement>(".chapter-state")!.textContent = state;
          for (const action of row.querySelectorAll<HTMLButtonElement>("[data-read-action]")) {
            const read = action.dataset.readAction === "true";
            action.hidden = read ? state === "Read" : state === "Unread";
            action.disabled = !data.available || data.busy;
          }
        }
      }
    }
    continuePanel.hidden = !continuation || scanning;
    if (!continuation) return;
    continuePanel.querySelector("h2")!.textContent = continuation.series.name;
    continuePanel.querySelector("p")!.textContent = `${continuation.chapter.displayName} - Page ${Math.min(continuation.record.pageIndex + 1, continuation.record.pageCount)} of ${continuation.record.pageCount}`;
    const percent = seriesProgress(continuation.series, records, data.allStatuses(root!.name)).percent;
    const bar = continuePanel.querySelector<HTMLElement>("[role=progressbar]")!;
    bar.setAttribute("aria-label", `${continuation.series.name} reading progress`);
    bar.setAttribute("aria-valuenow", String(percent));
    bar.querySelector<HTMLElement>(".progress-value")!.style.width = `${percent}%`;
  }
  subscriptions.push(data.subscribe(refreshProgress));
  subscriptions.push(data.subscribe(() => { document.querySelector<HTMLButtonElement>("#confirm-series-state")!.disabled = data.busy || !data.available; }));
  document.querySelector("#continue-button")!.addEventListener("click", () => {
    if (continuation && root && result) openChapter(continuation.series, continuation.chapter, continuation.record);
  }, { signal: lifetime.signal });

  function updateButtons(): void {
    rescanButtons.forEach(button => button.disabled = !root || scanning || connection.busy);
  }

  function cancelScan(): void {
    generation++;
    abort?.abort();
    abort = null;
    scanning = false;
    result = null;
    covers.reset(root);
    const detailWasOpen = !detail.hidden;
    resetDetail();
    if (detailWasOpen && !document.querySelector<HTMLElement>('[data-view="library"]')!.hidden) search.focus();
  }

  async function scan(): Promise<void> {
    if (destroyed || !root || scanning) return;
    cancelScan();
    const currentRoot = root;
    const currentGeneration = generation;
    const controller = new AbortController();
    abort = controller;
    const current = (): boolean => !destroyed && generation === currentGeneration && root === currentRoot;
    scanning = true;
    status.textContent = "Scanning library folders…";
    updateButtons();
    renderLibrary();
    try {
      if (await checkReadPermission(currentRoot) !== "granted") throw new DOMException("Read permission is missing", "NotAllowedError");
      controller.signal.throwIfAborted();
      const scanned = await scanLibrary(currentRoot, controller.signal);
      if (await checkReadPermission(currentRoot) !== "granted") throw new DOMException("Read permission changed", "NotAllowedError");
      await checkFolderAvailable(currentRoot);
      if (!current()) return;
      result = scanned;
      if (!scanned.inaccessibleFolders.length) void covers.prune(scanned.series);
      const warning = scanned.inaccessibleFolders.length
        ? ` Partial scan: ${count(scanned.inaccessibleFolders.length, "folder")} could not be read. Rescan to retry.` : "";
      status.textContent = scanned.series.length
        ? `Scan completed: ${scanned.series.length} series · ${count(scanned.chapterCount, "chapter")}.${warning}`
        : scanned.rootEntryCount === 0 ? "Connected folder is empty. Add series subfolders containing CBZ files, then rescan."
          : `${scanned.subfolderCount === 0 ? "No series subfolders found." : "No subfolders contain readable CBZ files."} Put CBZ chapters directly inside a series subfolder.${warning}`;
      renderLibrary();
    } catch (error) {
      if (!current() || controller.signal.aborted) return;
      console.warn("Unable to scan library", error);
      status.textContent = "Library scan failed. Check folder access and click Rescan to retry.";
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError", "NotFoundError"].includes(error.name)) {
        await reportAccessFailure(currentRoot, error);
      }
    } finally {
      if (current()) { scanning = false; abort = null; updateButtons(); search.disabled = sort.disabled = !root; refreshProgress(); scanListeners.forEach(listener => listener()); }
    }
  }

  function updateConnection(next: LibraryConnection): void {
    connection = next;
    const nextRoot = next.state === "connected" ? next.handle : null;
    if (nextRoot !== root || (nextRoot && next.revision !== revision)) {
      cancelScan();
      root = nextRoot;
      covers.reset(root);
      revision = next.revision;
      renderLibrary();
      if (root) void scan();
    }
    if (!root) {
      status.textContent = next.state === "restoring" ? "Restoring folder connection…"
        : next.state === "unsupported" ? "Local folder reading requires a browser with directory-picker support, such as desktop Chrome or Edge, on HTTPS or localhost."
          : ["permission", "denied"].includes(next.state) ? "Reconnect your folder to grant read permission."
          : next.state === "unavailable" ? "Folder is unavailable. Reconnect or choose another folder."
            : "Choose a local folder to load your library.";
    }
    updateButtons();
  }

  const seriesDialog = document.querySelector<HTMLDialogElement>("#series-state-dialog")!;
  let seriesInitiator: HTMLButtonElement | null = null;
  let seriesAction: { series: ComicSeries; root: FileSystemDirectoryHandle; read: boolean } | null = null;
  document.querySelectorAll<HTMLButtonElement>("[data-series-read]").forEach(button => button.addEventListener("click", () => {
    if (!root || !detailSeries || !data.available || data.busy) return;
    seriesInitiator = button; seriesAction = { root, series: detailSeries, read: button.dataset.seriesRead === "true" };
    document.querySelector("#series-state-title")!.textContent = seriesAction.read ? "Mark series read?" : "Mark series unread?";
    document.querySelector("#series-state-description")!.textContent = `${detailSeries.name}: ${seriesAction.read ? "Mark all currently scanned chapters read. Progress and bookmarks stay saved." : "Remove all progress and manual read states for this series. Bookmarks stay saved."} Comic files stay unchanged.`;
    seriesDialog.showModal();
  }, { signal: lifetime.signal }));
  document.querySelector("#cancel-series-state")!.addEventListener("click", () => seriesDialog.close(), { signal: lifetime.signal });
  seriesDialog.addEventListener("close", () => { seriesInitiator?.focus(); seriesAction = null; }, { signal: lifetime.signal });
  document.querySelector("#confirm-series-state")!.addEventListener("click", async () => {
    const action = seriesAction;
    if (!action || root !== action.root || !result?.series.includes(action.series) || data.busy || !data.available) { seriesDialog.close(); return; }
    try { await data.markChapters(root.name, action.series.id, action.series.chapters.map(c => c.id), action.read, true); notify(action.read ? "Series marked read." : "Series marked unread. Bookmarks retained."); }
    catch (error) { notify(error instanceof Error ? error.message : "Series state could not be changed."); }
    seriesDialog.close();
  }, { signal: lifetime.signal });
  search.addEventListener("input", renderLibrary, { signal: lifetime.signal });
  sort.addEventListener("change", renderLibrary, { signal: lifetime.signal });
  document.querySelector("#back-to-library")!.addEventListener("click", () => resetDetail(true), { signal: lifetime.signal });
  rescanButtons.forEach(button => button.addEventListener("click", () => { if (!connection.busy) void scan(); }, { signal: lifetime.signal }));
  document.querySelector("#clear-covers-button")!.addEventListener("covers-cleared", renderLibrary, { signal: lifetime.signal });
  renderLibrary();
  updateButtons();
  return {
    updateConnection,
    setVisible(value) { viewVisible = value; covers.setVisible(value && Boolean(detail.hidden)); },
    destroy(): void {
      if (destroyed) return;
      destroyed = true; generation++; abort?.abort(); abort = null;
      lifetime.abort();
      for (const unsubscribe of subscriptions) unsubscribe();
      scanListeners.clear();
      if (seriesDialog.open) seriesDialog.close();
      seriesAction = null; seriesInitiator = null;
      covers.destroy();
    },
    subscribeScan: listener => { scanListeners.add(listener); },
    resolveChapter(seriesId, chapterId) {
      if (!root || !result || scanning) return null;
      const series = result.series.find(s => s.id === seriesId); const chapter = series?.chapters.find(c => c.id === chapterId);
      return series && chapter ? { series, chapter } : null;
    },
    resetDetail: () => resetDetail(),
    returnToSeries(series, chapter): void {
      if (!result?.series.includes(series)) { resetDetail(); search.focus(); return; }
      overview.hidden = true;
      covers.setVisible(false);
      detail.hidden = false;
      const button = Array.from(chapterList.querySelectorAll<HTMLButtonElement>("button"))
        .find(item => item.dataset.chapterId === chapter.id);
      if (button) button.focus();
      else openSeries(series, returnCard);
    },
  };
}
