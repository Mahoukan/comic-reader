import type { LibraryConnection } from "./connection";
import { checkFolderAvailable, checkReadPermission } from "./folder-access";
import { scanLibrary, type ComicSeries, type LibraryScan } from "./library-scanner";
import { naturalCompare } from "./natural-sort";

const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;

export function initializeLibraryView(
  openPreview: () => void,
  reportAccessFailure: (root: FileSystemDirectoryHandle, error: unknown) => Promise<void>,
): { updateConnection: (connection: LibraryConnection) => void; resetDetail: () => void } {
  const grid = document.querySelector<HTMLDivElement>("#comic-grid")!;
  const samples = Array.from(grid.querySelectorAll<HTMLButtonElement>(".comic-card"));
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
  let returnCard: HTMLButtonElement | null = null;

  function resetDetail(restoreFocus = false): void {
    const wasOpen = !detail.hidden;
    detail.hidden = true;
    overview.hidden = false;
    chapterList.replaceChildren();
    detailTitle.textContent = "";
    detailCount.textContent = "";
    if (wasOpen && restoreFocus) (returnCard?.isConnected ? returnCard : search).focus();
    returnCard = null;
  }

  function openSeries(series: ComicSeries, card: HTMLButtonElement): void {
    returnCard = card;
    overview.hidden = true;
    detail.hidden = false;
    detailTitle.textContent = series.name;
    detailCount.textContent = `${count(series.chapters.length, "chapter")} · Reading is coming in Milestone 4.`;
    const rows = series.chapters.map(chapter => {
      const row = document.createElement("li");
      row.textContent = chapter.displayName;
      return row;
    });
    chapterList.replaceChildren(...rows);
    detailTitle.focus();
  }

  function realCard(series: ComicSeries): HTMLButtonElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "comic-card";
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
    card.append(cover, title, chapters);
    card.addEventListener("click", () => openSeries(series, card));
    return card;
  }

  function renderLibrary(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const real = Boolean(root);
    subtitle.textContent = real ? "Your local series · CBZ contents are not opened yet." : "Preview library · These sample comics are not from your folder.";
    heading.textContent = real ? "All series" : "Preview series";
    continuePanel.hidden = real;
    let total = 0;
    let visible = 0;
    if (real) {
      const series = [...(result?.series ?? [])];
      total = series.length;
      series.sort((a, b) => sort.value === "chapters"
        ? b.chapters.length - a.chapters.length || naturalCompare(a.name, b.name)
        : naturalCompare(a.name, b.name));
      const filtered = series.filter(item => item.name.toLocaleLowerCase().includes(query));
      visible = filtered.length;
      grid.replaceChildren(...filtered.map(realCard));
    } else {
      const sorted = [...samples].sort((a, b) => sort.value === "chapters"
        ? Number(b.dataset.chapters) - Number(a.dataset.chapters) || naturalCompare(a.dataset.title ?? "", b.dataset.title ?? "")
        : naturalCompare(a.dataset.title ?? "", b.dataset.title ?? ""));
      sorted.forEach(card => card.hidden = !(card.dataset.title ?? "").toLocaleLowerCase().includes(query));
      total = samples.length;
      visible = sorted.filter(card => !card.hidden).length;
      grid.replaceChildren(...sorted);
    }
    visibleCount.textContent = query ? `${visible} of ${total} series` : `${total} series`;
    emptySearch.hidden = visible !== 0 || total === 0;
    emptySearch.textContent = "No series match your search. Try another name or clear the search.";
    const summary = real ? result ? `${result.series.length} series · ${count(result.chapterCount, "chapter")}` : "Library not scanned yet" : "Preview · 4 sample series";
    document.querySelectorAll<HTMLElement>("[data-library-summary]").forEach(element => element.textContent = summary);
  }

  function updateButtons(): void {
    rescanButtons.forEach(button => button.disabled = !root || scanning || connection.busy);
  }

  function cancelScan(): void {
    generation++;
    abort?.abort();
    abort = null;
    scanning = false;
    result = null;
    const detailWasOpen = !detail.hidden;
    resetDetail();
    if (detailWasOpen && !document.querySelector<HTMLElement>('[data-view="library"]')!.hidden) search.focus();
  }

  async function scan(): Promise<void> {
    if (!root || scanning) return;
    cancelScan();
    const currentRoot = root;
    const currentGeneration = generation;
    const controller = new AbortController();
    abort = controller;
    const current = (): boolean => generation === currentGeneration && root === currentRoot;
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
      if (current()) { scanning = false; abort = null; updateButtons(); }
    }
  }

  function updateConnection(next: LibraryConnection): void {
    connection = next;
    const nextRoot = next.state === "connected" ? next.handle : null;
    if (nextRoot !== root || (nextRoot && next.revision !== revision)) {
      cancelScan();
      root = nextRoot;
      revision = next.revision;
      renderLibrary();
      if (root) void scan();
    }
    if (!root) {
      status.textContent = next.state === "restoring" ? "Restoring folder connection…"
        : ["permission", "denied"].includes(next.state) ? "Waiting for read permission. Preview data is shown."
          : next.state === "unavailable" ? "Folder is unavailable. Reconnect or choose another folder. Preview data is shown."
            : "No real library connected. Preview data is shown.";
    }
    updateButtons();
  }

  samples.forEach(card => card.addEventListener("click", openPreview));
  search.addEventListener("input", renderLibrary);
  sort.addEventListener("change", renderLibrary);
  document.querySelector("#back-to-library")!.addEventListener("click", () => resetDetail(true));
  rescanButtons.forEach(button => button.addEventListener("click", () => { if (!connection.busy) void scan(); }));
  renderLibrary();
  updateButtons();
  return { updateConnection, resetDetail: () => resetDetail() };
}
