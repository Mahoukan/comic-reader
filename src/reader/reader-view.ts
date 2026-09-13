import { bookmarkId, type ReadingAnchor } from "../storage/bookmarks";
import type { ProgressToken, ReadingData } from "../storage/reading-data";
import type { ReadingProgress } from "../storage/reading-progress";
import type { ComicChapter, ComicSeries } from "../library/library-scanner";
import { ArchiveError } from "./archive-safety";
import type { ComicPage } from "./cbz-reader";
import { ReadingSession, type SessionChapter } from "./reading-session";
import { initializeReaderControls } from "./reader-controls";

interface PageSlot {
  page: ComicPage;
  number: number;
  container: HTMLElement;
  message: HTMLElement;
  retry: HTMLButtonElement;
  back: HTMLButtonElement;
  image: HTMLImageElement | null;
  state: "idle" | "queued" | "loading" | "loaded" | "error";
}

interface ChapterSection {
  chapter: SessionChapter;
  section: HTMLElement;
  content: HTMLElement;
  end: HTMLElement;
  boundary: HTMLElement;
  slots: PageSlot[];
}

function chapterError(error: unknown): string {
  if (error instanceof ArchiveError) return error.message;
  if (error instanceof DOMException && error.name === "NotFoundError") return "This chapter file is no longer available.";
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) return "This file cannot be read. Check library permission.";
  return "This chapter could not be opened. It may be damaged, encrypted, or unsupported.";
}

export function initializeReaderView(
  backToSeries: (series: ComicSeries, chapter: ComicChapter) => void,
  backToLibrary: () => void,
  permissionLost: (error: unknown) => void,
  data: ReadingData,
  libraryName: () => string | null,
  notify: (message: string) => void,
) {
  const pagesElement = document.querySelector<HTMLElement>("#pages")!;
  const title = document.querySelector<HTMLElement>("#reader-series-name")!;
  const chapterName = document.querySelector<HTMLElement>("#reader-chapter-name")!;
  const status = document.querySelector<HTMLElement>("#reader-status")!;
  const backButton = document.querySelector<HTMLButtonElement>("#reader-back-button")!;
  const zoom = document.querySelector<HTMLInputElement>("#zoom-range")!;
  const zoomOutput = document.querySelector<HTMLOutputElement>("#zoom-output")!;
  const automatic = document.querySelector<HTMLInputElement>("#automatic-continuation")!;
  const readerAutomatic = document.querySelector<HTMLInputElement>("#reader-automatic-continuation")!;
  const sections = new Map<number, ChapterSection>();
  const pageTargets = new Map<Element, { section: ChapterSection; slot: PageSlot }>();
  const endTargets = new Map<Element, ChapterSection>();
  let session: ReadingSession | null = null;
  const bookmarkButton = document.querySelector<HTMLButtonElement>("#bookmark-button")!;
  let bookmarking = false;
  let pendingToken: ProgressToken | null = null;
  let saveTimer = 0;
  let pending: Omit<ReadingProgress, "updatedAt"> | null = null;
  let restore: ReadingAnchor | undefined;
  let restoring = false;
  function flushProgress(): void {
    window.clearTimeout(saveTimer); saveTimer = 0;
    if (pending) { const record = pending; pending = null; data.save(record, pendingToken ?? data.token(record)); pendingToken = null; }
  }
  function currentAnchor(view = session ? sections.get(session.currentIndex) : undefined): Omit<ReadingProgress, "completed" | "updatedAt"> | null {
    if (!session || restoring || !view?.slots.length) return null;
    const name = libraryName(); if (!name) return null;
    const line = readingLine();
    const distance = (item: PageSlot): number => { const r = item.container.getBoundingClientRect(); return Math.max(r.top - line, line - r.bottom, 0); };
    const slot = view.slots.reduce((best, value) => distance(value) < distance(best) ? value : best);
    const rect = slot.container.getBoundingClientRect();
    const offsetRatio = Math.round(Math.max(0, Math.min(1, (line - rect.top) / Math.max(1, rect.height))) * 1000) / 1000;
    return { libraryName: name, seriesId: session.series.id, seriesName: session.series.name,
      chapterId: view.chapter.chapter.id, chapterName: view.chapter.chapter.displayName,
      pageIndex: slot.number - 1, pageCount: view.slots.length, offsetRatio };
  }
  function capture(completed = false, view = session ? sections.get(session.currentIndex) : undefined): void {
    const anchor = currentAnchor(view); if (!anchor || data.busy) return;
    const record = { ...anchor, completed };
    if (pending && JSON.stringify(pending) === JSON.stringify(record)) return;
    const previous = data.all(anchor.libraryName).find(r => r.seriesId === record.seriesId && r.chapterId === record.chapterId);
    if (!pending && previous && previous.pageCount === record.pageCount && previous.pageIndex === record.pageIndex && previous.offsetRatio === record.offsetRatio && (!completed || previous.completed)) return;
    pending = record; pendingToken = data.token(record); window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushProgress, 700);
    if (completed) flushProgress();
  }
  function syncBookmark(): void {
    const anchor = currentAnchor();
    bookmarkButton.disabled = !anchor || !data.available || (data.busy && !bookmarking);
    bookmarkButton.setAttribute("aria-pressed", String(Boolean(anchor && data.allBookmarks(anchor.libraryName).some(b => b.id === bookmarkId(anchor)))));
    bookmarkButton.textContent = bookmarkButton.getAttribute("aria-pressed") === "true" ? "Remove bookmark" : "Bookmark page";
    bookmarkButton.title = !data.available ? "Saved reading data is unavailable on this device." : "Toggle bookmark for the current reading page";
  }
  const toggleBookmark = async (): Promise<void> => {
    trackVisible(false);
    const anchor = currentAnchor(); if (!anchor || !data.available || data.busy) return;
    bookmarking = true;
    try { notify(await data.toggleBookmark(anchor) ? "Page bookmarked." : "Bookmark removed."); }
    catch (error) { notify(error instanceof Error ? error.message : "Bookmark could not be saved."); }
    finally { bookmarking = false; syncBookmark(); }
  };
  bookmarkButton.addEventListener("click", toggleBookmark);
  data.subscribe(syncBookmark);
  function applyPreferences(): void {
    const prefs = data.preferences; setZoom(prefs.zoom);
    automatic.checked = readerAutomatic.checked = prefs.automaticContinuation;
    pagesElement.style.setProperty("--page-gap", ({ none: "0px", small: "8px", medium: "24px", large: "48px" })[prefs.spacing]);
    document.querySelector<HTMLElement>(".reader-view")!.dataset.background = prefs.background;
    for (const view of sections.values()) if (session) updateBoundary(session, view);
  }
  let appliedPreferences = "";
  data.subscribe(() => {
    const signature = JSON.stringify(data.preferences);
    if (signature !== appliedPreferences) { appliedPreferences = signature; applyPreferences(); }
  });
  let pageObserver: IntersectionObserver | null = null;
  let endObserver: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let transition: Promise<void> = Promise.resolve();
  let frame = 0;
  let generation = 0;
  let destroyed = false;
  let endedSeries = false;
  let openingSelection = false;
  let startingSelection: { series: ComicSeries; chapter: ComicChapter } | null = null;

  function button(text: string, action: () => void): HTMLButtonElement {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "button button-secondary";
    result.textContent = text;
    result.addEventListener("click", action);
    return result;
  }

  function setZoom(value: number): void {
    zoom.value = String(value);
    zoomOutput.value = `${value}%`;
    pagesElement.style.setProperty("--reader-width", `${Math.round(720 * value / 100)}px`);
    scheduleTracking();
  }

  function clear(save = true, leaving = true): Promise<void> {
    if (save) { trackVisible(false); capture(); flushProgress(); }
    else { window.clearTimeout(saveTimer); pending = null; pendingToken = null; }
    restoring = false; restore = undefined;
    generation++;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pageObserver?.disconnect(); endObserver?.disconnect(); resizeObserver?.disconnect();
    pageObserver = endObserver = null;
    resizeObserver = null;
    const previous = session;
    session = null;
    syncBookmark();
    openingSelection = false;
    startingSelection = null;
    if (leaving) { controls.leave(); controls.reset(); }
    // close() revokes URLs synchronously, then waits for pending operations.
    const closing = previous?.close();
    sections.clear(); pageTargets.clear(); endTargets.clear();
    pagesElement.replaceChildren();
    endedSeries = false;
    title.textContent = "Reader";
    chapterName.textContent = "Choose a chapter from your library.";
    status.textContent = "No chapter open.";
    backButton.textContent = "← Library";
    transition = Promise.allSettled([transition, closing]).then(() => {});
    return transition;
  }

  function goBack(): void {
    trackVisible(false);
    const previous = session;
    const chapter = previous?.currentChapter ?? startingSelection?.chapter;
    const series = previous?.series ?? startingSelection?.series;
    void clear();
    if (series && chapter) backToSeries(series, chapter);
    else backToLibrary();
  }

  function mount(active: ReadingSession, chapter: SessionChapter): void {
    const section = document.createElement("section");
    section.className = "reader-chapter";
    section.dataset.chapterId = chapter.chapter.id;
    section.dataset.chapterIndex = String(chapter.index);
    const start = document.createElement("h2");
    start.className = "chapter-start";
    start.textContent = chapter.chapter.displayName;
    start.id = `chapter-${generation}-${chapter.index}`;
    section.setAttribute("aria-labelledby", start.id);
    const content = document.createElement("div");
    content.className = "chapter-content";
    content.textContent = `Opening ${chapter.chapter.displayName}… Pages will load as you scroll.`;
    content.setAttribute("aria-busy", "true");
    const end = document.createElement("div");
    end.className = "chapter-end";
    end.textContent = `End of ${chapter.chapter.displayName}`;
    const boundary = document.createElement("div");
    boundary.className = "chapter-boundary";
    section.append(start, content, end, boundary);
    const view: ChapterSection = { chapter, section, content, end, boundary, slots: [] };
    sections.set(chapter.index, view);
    pagesElement.append(section);
    resizeObserver?.observe(section);
    const previous = sections.get(chapter.index - 1);
    if (previous) updateBoundary(active, previous);
    updateBoundary(active, view);
    scheduleTracking();
  }

  function updateBoundary(active: ReadingSession, view: ChapterSection): void {
    view.boundary.replaceChildren();
    view.end.hidden = !["ready", "rendering"].includes(view.chapter.state);
    if (view.end.hidden) return;
    const next = active.series.chapters[view.chapter.index + 1];
    if (!next) {
      view.boundary.textContent = "End of series";
      view.boundary.append(button("Back to series", goBack));
      return;
    }
    if (sections.has(view.chapter.index + 1)) return;
    view.boundary.textContent = automatic.checked ? `Next: ${next.displayName}` : "";
    // A manual fallback also keeps browsers without IntersectionObserver usable.
    view.boundary.append(button("Continue to next chapter", () => {
      if (session === active) void active.prepareNext(view.chapter.index);
    }));
  }

  function removeSection(chapter: SessionChapter): void {
    const view = sections.get(chapter.index);
    if (!view) return;
    const anchor = session ? sections.get(session.currentIndex)?.section : null;
    const before = anchor && anchor !== view.section ? anchor.getBoundingClientRect().top : null;
    for (const slot of view.slots) {
      pageObserver?.unobserve(slot.container);
      pageTargets.delete(slot.container);
      if (slot.image) { slot.image.removeAttribute("src"); slot.image.remove(); }
    }
    view.slots = [];
    endObserver?.unobserve(view.end); endTargets.delete(view.end);
    resizeObserver?.unobserve(view.section);
    view.section.remove();
    sections.delete(chapter.index);
    // Browser scroll anchoring is disabled so compensation is applied once.
    if (before !== null && anchor?.isConnected) {
      const delta = anchor.getBoundingClientRect().top - before;
      if (delta) window.scrollBy({ top: delta, behavior: "instant" });
    }
    if (session) {
      const previous = sections.get(chapter.index - 1);
      if (previous) updateBoundary(session, previous);
    }
  }

  function enqueue(active: ReadingSession, view: ChapterSection, slot: PageSlot): void {
    if (session !== active || !active.isActive(view.chapter) || !["idle", "error"].includes(slot.state)) return;
    slot.state = "queued";
    if (document.activeElement === slot.retry) slot.container.focus({ preventScroll: true });
    slot.retry.hidden = true;
    slot.back.hidden = true;
    active.enqueue(view.chapter, () => loadSlot(active, view, slot));
  }

  function readingLine(): number {
    const toolbarBottom = document.querySelector<HTMLElement>(".reader-toolbar")!.getBoundingClientRect().bottom;
    return Math.max(0, toolbarBottom) + Math.max(0, window.innerHeight - Math.max(0, toolbarBottom)) * 0.35;
  }

  function readingAnchor(): HTMLElement | null {
    const line = readingLine();
    let anchor: HTMLElement | null = null;
    let closest = Infinity;
    for (const view of sections.values()) for (const slot of view.slots) {
      const rect = slot.container.getBoundingClientRect();
      const distance = Math.max(rect.top - line, line - rect.bottom, 0);
      if (distance < closest) { closest = distance; anchor = slot.container; }
    }
    return anchor;
  }

  function preserveAnchor(anchor: HTMLElement | null, before: number | null): void {
    if (before === null || !anchor?.isConnected) return;
    const delta = anchor.getBoundingClientRect().top - before;
    if (delta) window.scrollBy({ top: delta, behavior: "instant" });
  }

  async function loadSlot(active: ReadingSession, view: ChapterSection, slot: PageSlot): Promise<void> {
    const archive = view.chapter.archive;
    const current = (): boolean => session === active && active.isActive(view.chapter) && view.chapter.archive === archive;
    if (!archive || !current()) return;
    view.chapter.state = "rendering";
    slot.state = "loading";
    slot.message.textContent = `Loading page ${slot.number}…`;
    slot.retry.hidden = true;
    slot.container.setAttribute("aria-busy", "true");
    let url: string | null = null;
    try {
      const blob = await archive.loadPage(slot.page);
      if (!current()) return;
      url = active.createURL(view.chapter, blob);
      if (!url) return;
      const image = document.createElement("img");
      image.alt = `${view.chapter.chapter.displayName} · Page ${slot.number}`;
      image.decoding = "async";
      image.hidden = true;
      slot.image = image;
      slot.container.append(image);
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        const signal = view.chapter.controller.signal;
        const abort = (): void => reject(new DOMException("Chapter closed", "AbortError"));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        void image.decode().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      if (!current()) return;
      const anchor = readingAnchor();
      const before = anchor?.getBoundingClientRect().top ?? null;
      slot.state = "loaded";
      image.width = image.naturalWidth;
      image.height = image.naturalHeight;
      image.hidden = false;
      slot.message.hidden = true;
      slot.container.classList.add("loaded");
      // A queued page above the reading line may change height after decoding.
      preserveAnchor(anchor, before);
      if (restoring && restore && view.chapter.index === active.startIndex && slot.number - 1 === Math.min(restore.pageIndex, view.slots.length - 1)) finishRestore(slot, false);
      scheduleTracking();
    } catch (error) {
      if (url) active.revokeURL(view.chapter, url);
      if (!current()) return;
      console.warn("Unable to load comic page", error);
      slot.image?.remove(); slot.image = null;
      slot.state = "error";
      slot.message.hidden = false;
      slot.message.textContent = `Page ${slot.number} could not be loaded. Retry this page or return to the series.`;
      slot.retry.hidden = false;
      slot.back.hidden = false;
      status.textContent = `${view.chapter.chapter.displayName}: page ${slot.number} could not be loaded. Retry is available.`;
      // The connection controller checks actual root permission before disconnecting anything.
      if (restoring && restore && view.chapter.index === active.startIndex && slot.number - 1 === Math.min(restore.pageIndex, view.slots.length - 1)) finishRestore(slot, true);
      permissionLost(error);
    } finally { if (current()) slot.container.setAttribute("aria-busy", "false"); }
  }

  function chapterChanged(active: ReadingSession, chapter: SessionChapter, error?: unknown): void {
    if (session !== active) return;
    const view = sections.get(chapter.index)!;
    const previous = sections.get(chapter.index - 1);
    if (previous) updateBoundary(active, previous);
    if (chapter.state === "opening") {
      view.content.setAttribute("aria-busy", "true");
      view.content.textContent = `Opening ${chapter.chapter.displayName}… Pages will load as you scroll.`;
      return;
    }
    view.content.setAttribute("aria-busy", "false");
    if (chapter.state === "failed") {
      console.warn("Unable to open chapter", error);
      const message = document.createElement("p");
      message.textContent = `${chapter.index > active.currentIndex ? "Next chapter " : ""}${chapter.chapter.displayName}: ${chapterError(error)}${chapter.index > active.currentIndex ? " The current chapter remains available above." : ""}`;
      view.content.replaceChildren(message,
        button("Retry chapter", () => {
          if (session !== active) return;
          const heading = view.section.querySelector<HTMLElement>(".chapter-start")!;
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
          void active.retry(chapter);
        }),
        button("Back to series", goBack));
      view.boundary.replaceChildren();
      restoring = false; restore = undefined;
      status.textContent = message.textContent;
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) permissionLost(error);
      return;
    }
    const archive = chapter.archive!;
    view.slots = archive.pages.map((page, index) => {
      const container = document.createElement("div");
      container.className = "real-comic-page";
      container.dataset.pageNumber = String(index + 1);
      container.tabIndex = -1;
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", `Page ${index + 1}`);
      const message = document.createElement("p");
      message.textContent = `Page ${index + 1}`;
      const retry = button(`Retry page ${index + 1}`, () => enqueue(active, view, slot));
      retry.hidden = true;
      const back = button("Back to series", goBack);
      back.hidden = true;
      const slot: PageSlot = { page, number: index + 1, container, message, retry, back, image: null, state: "idle" };
      container.append(message, retry, back);
      pageTargets.set(container, { section: view, slot });
      return slot;
    });
    view.content.replaceChildren(...view.slots.map(slot => slot.container));
    if (!view.slots.length) {
      const message = document.createElement("p");
      message.textContent = "This chapter contains no supported image pages. You can retry after replacing the file, choose another chapter, or return to the series.";
      view.content.replaceChildren(message,
        button("Retry chapter", () => { if (session === active) open(active.series, chapter.chapter); }),
        button("Back to series", goBack));
      status.textContent = `${chapter.chapter.displayName} has no supported image pages.`;
    }
    if (restoring && restore && chapter.index === active.startIndex) {
      const target = view.slots[Math.min(restore.pageIndex, view.slots.length - 1)];
      if (target) { positionRestore(target); enqueue(active, view, target); }
      else { restoring = false; restore = undefined; status.textContent = "Saved position could not be restored: this chapter has no image pages."; }
    }
    if (pageObserver) view.slots.forEach(slot => pageObserver!.observe(slot.container));
    else view.slots.forEach(slot => { slot.retry.textContent = `Load page ${slot.number}`; slot.retry.hidden = false; });
    endTargets.set(view.end, view);
    endObserver?.observe(view.end);
    updateBoundary(active, view);
    if (!restoring && chapter.index === active.currentIndex && view.slots.length) status.textContent = `${chapter.chapter.displayName} · ${archive.pages.length} pages. Scroll to read.`;
    scheduleTracking();
  }

  function scheduleTracking(): void {
    if (!session || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; trackVisible(); });
  }

  function trackVisible(prepare = true): void {
    const active = session;
    if (!active || restoring) return;
    const line = readingLine();
    const distance = (element: HTMLElement): number => {
      const rect = element.getBoundingClientRect();
      return line < rect.top ? rect.top - line : line > rect.bottom ? line - rect.bottom : 0;
    };
    const ready = [...sections.values()].filter(view => active.isActive(view.chapter) && view.chapter.archive);
    let candidate = ready.reduce<ChapterSection | null>((best, view) => !best || distance(view.section) < distance(best.section) ? view : best, null);
    const currentView = sections.get(active.currentIndex);
    if (candidate && currentView && candidate.chapter.index !== active.currentIndex) {
      const forward = candidate.chapter.index > active.currentIndex;
      // An 80px dead band prevents labels/resources thrashing at a boundary.
      if (forward ? line < candidate.section.getBoundingClientRect().top + 80 : line > currentView.section.getBoundingClientRect().top - 80) candidate = currentView;
    }
    if (candidate && candidate.chapter.index > active.currentIndex && currentView) capture(true, currentView);
    if (candidate && candidate.chapter.index !== active.currentIndex) flushProgress();
    if (candidate) active.setCurrent(candidate.chapter.index);
    const visible = sections.get(active.currentIndex);
    if (!visible?.chapter.archive) return;
    const page = visible.slots.reduce<PageSlot | null>((best, slot) => !best || distance(slot.container) < distance(best.container) ? slot : best, null);
    const label = `${active.currentChapter.displayName} · ${page ? `Page ${page.number} of ${visible.slots.length}` : "No image pages"}`;
    if (chapterName.textContent !== label) chapterName.textContent = label;
    capture(); syncBookmark();
    const endRect = visible.end.getBoundingClientRect();
    if (prepare && automatic.checked && endRect.top <= window.innerHeight * 2 && endRect.bottom >= 0) void active.prepareNext(active.currentIndex);
    if (active.currentIndex === active.series.chapters.length - 1 && endRect.top >= Math.max(0, document.querySelector<HTMLElement>(".reader-toolbar")!.getBoundingClientRect().bottom) && endRect.bottom <= window.innerHeight - 64 && !endedSeries) {
      capture(true);
      endedSeries = true;
      status.textContent = `End of ${active.currentChapter.displayName}. End of series.`;
    }
  }

  function positionRestore(slot: PageSlot): void {
    if (!restore) return;
    for (let i = 0; i < 2; i++) {
      const rect = slot.container.getBoundingClientRect();
      window.scrollBy({ top: rect.top + rect.height * restore.offsetRatio - readingLine(), behavior: "instant" });
    }
  }
  function finishRestore(slot: PageSlot, failed: boolean): void {
    if (session) chapterName.textContent = `${session.currentChapter.displayName} \u00b7 Page ${slot.number} of ${sections.get(session.currentIndex)!.slots.length}`;

    status.textContent = failed ? "Saved page could not be loaded. Position restored to its placeholder; Retry is available." : `Reading position restored: page ${slot.number}.`;
    positionRestore(slot); restoring = false; restore = undefined;
    scheduleTracking();
  }
  function open(series: ComicSeries, chapter: ComicChapter, position?: ReadingAnchor, focusBack = true): void {
    if (destroyed) return;
    void clear(true, false);
    restore = position; restoring = Boolean(position);
    const operation = generation;
    openingSelection = true;
    startingSelection = { series, chapter };
    controls.sync(series, chapter);
    title.textContent = series.name;
    chapterName.textContent = chapter.displayName;
    backButton.textContent = "← Back to series";
    status.textContent = restoring ? "Restoring reading position..." : "Opening chapter...";
    applyPreferences();
    if (!position) window.scrollTo({ top: 0, behavior: "instant" });
    if (focusBack) (document.querySelector<HTMLElement>("#reader-toolbar")!.hidden
      ? document.querySelector<HTMLButtonElement>("#show-reader-controls")! : backButton).focus({ preventScroll: true });
    transition = transition.then(async () => {
      if (generation !== operation) return;
      const active = new ReadingSession(series, chapter, {
        mounted: mounted => { if (session === active) mount(active, mounted); },
        changed: (mounted, error) => chapterChanged(active, mounted, error),
        removed: removeSection,
        currentChanged: mounted => {
          if (session === active) {
            controls.sync(active.series, mounted.chapter);
            status.textContent = `Now reading ${mounted.chapter.displayName}.`;
          }
        },
      });
      session = active;
      openingSelection = false;
      if (typeof IntersectionObserver === "function") {
        const margin = `${Math.max(window.innerHeight, 600)}px 0px`;
        pageObserver = new IntersectionObserver(entries => {
          if (session !== active) return;
          for (const entry of entries) {
            const target = pageTargets.get(entry.target);
            if (entry.isIntersecting && target) { pageObserver?.unobserve(entry.target); enqueue(active, target.section, target.slot); }
          }
        }, { rootMargin: margin });
        endObserver = new IntersectionObserver(entries => {
          if (session !== active || restoring || !automatic.checked) return;
          for (const entry of entries) {
            const view = endTargets.get(entry.target);
            if (entry.isIntersecting && view) void active.prepareNext(view.chapter.index);
          }
        }, { rootMargin: margin });
      }
      if (typeof ResizeObserver === "function") resizeObserver = new ResizeObserver(scheduleTracking);
      await active.start();
    }).catch(error => {
      if (generation !== operation) return;
      console.warn("Unable to start reading session", error);
      openingSelection = false;
      status.textContent = "This reading session could not be started. Retry the chapter or return to the series.";
      pagesElement.replaceChildren(button("Retry chapter", () => open(series, chapter)), button("Back to series", goBack));
    });
  }

  function preview(): void {
    if (destroyed) return;
    void clear();
    applyPreferences();
    title.textContent = "Skybound Archive · Preview";
    chapterName.textContent = "Sample pages · No local chapter open";
    status.textContent = "Preview reader. Choose a real chapter from a connected library.";
    backButton.focus();
    for (const number of [1, 2]) {
      const page = document.createElement("div"); page.className = "comic-page"; page.textContent = `Preview page ${number}`;
      pagesElement.append(page);
    }
  }

  const onZoom = (): void => data.setPreferences({ zoom: Number(zoom.value) });
  const fitWidth = (): void => data.setPreferences({ zoom: 100 });
  const controls = initializeReaderControls({
    open: (series, chapter) => open(series, chapter, undefined, false),
    fitWidth,
    bookmark: () => { void toggleBookmark(); },
    announce: message => { status.textContent = message; },
    layout: change => {
      const anchor = readingAnchor();
      const before = anchor?.getBoundingClientRect().top ?? null;
      change();
      preserveAnchor(anchor, before);
      scheduleTracking();
    },
  });
  const libraryAction = (): void => { void clear(); backToLibrary(); };
  const continuationChanged = (event: Event): void => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    data.setPreferences({ automaticContinuation: enabled });
    if (!session) return;
    for (const view of sections.values()) updateBoundary(session, view);
    scheduleTracking();
  };
  zoom.addEventListener("input", onZoom);
  document.querySelector("#fit-width-button")!.addEventListener("click", fitWidth);
  backButton.addEventListener("click", goBack);
  document.querySelector("#reader-library-button")!.addEventListener("click", libraryAction);
  automatic.addEventListener("change", continuationChanged);
  readerAutomatic.addEventListener("change", continuationChanged);
  window.addEventListener("scroll", scheduleTracking, { passive: true });
  window.addEventListener("resize", scheduleTracking);
  const onHidden = (): void => { if (document.visibilityState === "hidden") { capture(); flushProgress(); data.flushPreferences(); } };
  document.addEventListener("visibilitychange", onHidden);
  const onPageHide = (event: PageTransitionEvent): void => { data.flushPreferences(); if (event.persisted) void clear(); else destroy(); };
  const destroy = (): void => {
    destroyed = true;
    void clear();
    controls.destroy();
    zoom.removeEventListener("input", onZoom);
    document.querySelector("#fit-width-button")!.removeEventListener("click", fitWidth);
    backButton.removeEventListener("click", goBack);
    document.querySelector("#reader-library-button")!.removeEventListener("click", libraryAction);
    automatic.removeEventListener("change", continuationChanged);
    readerAutomatic.removeEventListener("change", continuationChanged);
    window.removeEventListener("scroll", scheduleTracking);
    window.removeEventListener("resize", scheduleTracking);
    window.removeEventListener("pagehide", onPageHide);
    bookmarkButton.removeEventListener("click", toggleBookmark);
    document.removeEventListener("visibilitychange", onHidden);
  };
  window.addEventListener("pagehide", onPageHide);
  applyPreferences(); syncBookmark();
  return { open, preview, close: () => clear(), closeWithoutSaving: () => clear(false), destroy, resetReadingData: () => { window.clearTimeout(saveTimer); pending = null; pendingToken = null; }, isOpen: () => session !== null || openingSelection };
}
