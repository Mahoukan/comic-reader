import type { ComicChapter, ComicSeries } from "../library/library-scanner";
import { ArchiveError } from "./archive-safety";
import { openChapter, type ComicPage, type OpenedChapter } from "./cbz-reader";

interface PageSlot {
  page: ComicPage;
  number: number;
  container: HTMLElement;
  message: HTMLElement;
  retry: HTMLButtonElement;
  image: HTMLImageElement | null;
  state: "idle" | "queued" | "loading" | "loaded" | "error";
}

export function initializeReaderView(
  backToSeries: (series: ComicSeries, chapter: ComicChapter) => void,
  backToLibrary: () => void,
  permissionLost: (error: unknown) => void,
) {
  const pagesElement = document.querySelector<HTMLElement>("#pages")!;
  const title = document.querySelector<HTMLElement>("#reader-series-name")!;
  const chapterName = document.querySelector<HTMLElement>("#reader-chapter-name")!;
  const status = document.querySelector<HTMLElement>("#reader-status")!;
  const backButton = document.querySelector<HTMLButtonElement>("#reader-back-button")!;
  const zoom = document.querySelector<HTMLInputElement>("#zoom-range")!;
  const zoomOutput = document.querySelector<HTMLOutputElement>("#zoom-output")!;
  let generation = 0;
  let controller: AbortController | null = null;
  let archive: OpenedChapter | null = null;
  let observer: IntersectionObserver | null = null;
  let transition: Promise<void> = Promise.resolve();
  let selection: { series: ComicSeries; chapter: ComicChapter } | null = null;
  let slots: PageSlot[] = [];
  let queue: PageSlot[] = [];
  const urls = new Set<string>();
  let destroyed = false;

  function setZoom(value: number): void {
    zoom.value = String(value);
    zoomOutput.value = `${value}%`;
    pagesElement.style.setProperty("--reader-width", `${Math.round(720 * value / 100)}px`);
  }

  function clear(): Promise<void> {
    generation++;
    controller?.abort();
    controller = null;
    observer?.disconnect();
    observer = null;
    queue = [];
    for (const slot of slots) {
      if (slot.image) { slot.image.onload = slot.image.onerror = null; slot.image.removeAttribute("src"); }
    }
    slots = [];
    pagesElement.replaceChildren();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    const previous = archive;
    archive = null;
    selection = null;
    title.textContent = "Reader";
    chapterName.textContent = "Choose a chapter from your library.";
    status.textContent = "No chapter open.";
    backButton.textContent = "← Library";
    transition = transition.catch(() => {}).then(async () => {
      await previous?.close().catch(error => console.warn("Unable to close chapter", error));
    });
    return transition;
  }

  function goBack(): void {
    const previous = selection;
    void clear();
    if (previous) backToSeries(previous.series, previous.chapter);
    else backToLibrary();
  }

  async function loadSlot(slot: PageSlot, active: OpenedChapter, operation: number): Promise<void> {
    const current = (): boolean => generation === operation && archive === active;
    if (!current()) return;
    slot.state = "loading";
    slot.message.textContent = `Loading page ${slot.number}…`;
    slot.retry.hidden = true;
    slot.container.setAttribute("aria-busy", "true");
    let url: string | null = null;
    try {
      const blob = await active.loadPage(slot.page);
      if (!current()) return;
      url = URL.createObjectURL(blob);
      urls.add(url);
      const image = document.createElement("img");
      image.alt = `Page ${slot.number}`;
      image.decoding = "async";
      // Extraction is already lazy; native lazy loading can stall decode() on hidden images.
      image.loading = "eager";
      image.hidden = true;
      slot.image = image;
      slot.container.append(image);
      // decode() rejects corrupt images and can be cancelled by removing src during cleanup.
      image.src = url;
      await image.decode();
      if (!current()) return;
      slot.state = "loaded";
      image.hidden = false;
      slot.message.hidden = true;
      slot.container.classList.add("loaded");
    } catch (error) {
      if (url) { URL.revokeObjectURL(url); urls.delete(url); }
      if (!current()) return;
      console.warn("Unable to load comic page", error);
      slot.image?.remove();
      slot.image = null;
      slot.state = "error";
      slot.message.textContent = error instanceof ArchiveError ? error.message : `Page ${slot.number} could not be loaded.`;
      slot.retry.hidden = false;
    } finally { if (current()) slot.container.setAttribute("aria-busy", "false"); }
  }

  function renderPages(active: OpenedChapter, operation: number, name: string): void {
    let pumping = false;
    const pump = async (): Promise<void> => {
      if (pumping) return;
      pumping = true;
      // One extraction at a time keeps decompression memory predictable.
      while (queue.length && generation === operation) await loadSlot(queue.shift()!, active, operation);
      pumping = false;
    };
    const enqueue = (slot: PageSlot): void => {
      if (generation !== operation || !["idle", "error"].includes(slot.state)) return;
      slot.state = "queued";
      queue.push(slot);
      void pump();
    };
    slots = active.pages.map((page, index) => {
      const container = document.createElement("div");
      container.className = "real-comic-page";
      const message = document.createElement("p");
      message.textContent = `Page ${index + 1}`;
      message.setAttribute("role", "status");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button button-secondary";
      retry.textContent = `Retry page ${index + 1}`;
      retry.hidden = true;
      const slot: PageSlot = { page, number: index + 1, container, message, retry, image: null, state: "idle" };
      retry.addEventListener("click", () => enqueue(slot));
      container.append(message, retry);
      return slot;
    });
    const end = document.createElement("div");
    end.className = "chapter-divider";
    const endTitle = document.createElement("strong");
    endTitle.textContent = `End of ${name}`;
    const back = document.createElement("button");
    back.type = "button";
    back.className = "button button-secondary";
    back.textContent = "Back to series";
    back.addEventListener("click", goBack);
    end.append(endTitle, back);
    pagesElement.replaceChildren(...slots.map(slot => slot.container), end);
    if (typeof IntersectionObserver === "function") {
      const byElement = new Map(slots.map(slot => [slot.container, slot]));
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || generation !== operation) continue;
          const slot = byElement.get(entry.target as HTMLElement);
          if (slot) { observer?.unobserve(slot.container); enqueue(slot); }
        }
      }, { rootMargin: `${Math.max(window.innerHeight, 600)}px 0px` });
      slots.forEach(slot => observer!.observe(slot.container));
    } else {
      // A browser without the observer can still load individual pages explicitly.
      slots.forEach(slot => { slot.retry.textContent = `Load page ${slot.number}`; slot.retry.hidden = false; });
    }
  }

  function open(series: ComicSeries, chapter: ComicChapter): void {
    if (destroyed) return;
    void clear();
    const operation = generation;
    const abort = new AbortController();
    controller = abort;
    selection = { series, chapter };
    title.textContent = series.name;
    chapterName.textContent = chapter.displayName;
    backButton.textContent = "← Back to series";
    status.textContent = "Opening chapter…";
    setZoom(100);
    backButton.focus();
    transition = transition.then(async () => {
      if (generation !== operation) return;
      try {
        const opened = await openChapter(chapter.fileHandle, abort.signal);
        if (generation !== operation) { await opened.close(); return; }
        archive = opened;
        if (!opened.pages.length) { status.textContent = "This chapter contains no supported image pages."; return; }
        status.textContent = `${opened.pages.length} pages · Scroll to read.`;
        renderPages(opened, operation, chapter.displayName);
      } catch (error) {
        if (generation !== operation || abort.signal.aborted) return;
        console.warn("Unable to open chapter", error);
        status.textContent = error instanceof ArchiveError ? error.message
          : error instanceof DOMException && error.name === "NotFoundError" ? "This chapter file is no longer available. Return to the series and choose another chapter."
            : error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name) ? "This file cannot be read. Check permission or return to the series and choose another chapter."
              : "This chapter could not be opened. It may be damaged, encrypted, or use an unsupported ZIP format.";
        if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) permissionLost(error);
      }
    });
  }

  function preview(): void {
    if (destroyed) return;
    void clear();
    setZoom(100);
    title.textContent = "Skybound Archive · Preview";
    chapterName.textContent = "Sample pages · No local chapter open";
    status.textContent = "Preview reader. Choose a real chapter from a connected library.";
    backButton.focus();
    for (const number of [1, 2]) {
      const page = document.createElement("div");
      page.className = "comic-page";
      page.textContent = `Preview page ${number}`;
      pagesElement.append(page);
    }
  }

  const onZoom = (): void => setZoom(Number(zoom.value));
  const fitWidth = (): void => setZoom(100);
  const libraryAction = (): void => { void clear(); backToLibrary(); };
  zoom.addEventListener("input", onZoom);
  document.querySelector("#fit-width-button")!.addEventListener("click", fitWidth);
  backButton.addEventListener("click", goBack);
  document.querySelector("#reader-library-button")!.addEventListener("click", libraryAction);
  const onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) void clear();
    else destroy();
  };
  const destroy = (): void => {
    destroyed = true;
    void clear();
    zoom.removeEventListener("input", onZoom);
    document.querySelector("#fit-width-button")!.removeEventListener("click", fitWidth);
    backButton.removeEventListener("click", goBack);
    document.querySelector("#reader-library-button")!.removeEventListener("click", libraryAction);
    window.removeEventListener("pagehide", onPageHide);
  };
  window.addEventListener("pagehide", onPageHide);
  setZoom(100);
  return { open, preview, close: clear, destroy, isOpen: () => selection !== null };
}
