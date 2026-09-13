import { CoverThumbnails, matchesSource, type CoverSource, type CoverThumbnailRecord } from "../storage/cover-thumbnails";
import type { ComicSeries } from "./library-scanner";
import { generateCover } from "./cover-generator";

interface CoverCard {
  series: ComicSeries; card: HTMLElement; cover: HTMLElement; status: HTMLElement; retry: HTMLButtonElement;
  near: boolean; url: string | null;
}
interface CoverJob { series: ComicSeries; root: FileSystemDirectoryHandle; generation: number; signal: AbortSignal }

export function initializeCoverView(notify: (message: string) => void) {
  const explanation = document.querySelector<HTMLElement>("#cover-cache-explanation")!;
  let sessionOnly = false;
  const cache = new CoverThumbnails(() => {
    sessionOnly = true; settings();
  });
  const clearButton = document.querySelector<HTMLButtonElement>("#clear-covers-button")!;
  const cards = new Map<Element, CoverCard>();
  const failures = new Set<string>();
  const validated = new Map<string, CoverSource>();
  let root: FileSystemDirectoryHandle | null = null;
  let generation = 0;
  let controller = new AbortController();
  let observer: IntersectionObserver | null = null;
  let queue: CoverJob[] = [];
  let running: CoverJob | null = null;
  let clearing = false;
  let destroyed = false;
  let visible = true;

  function settings(): void {
    clearButton.disabled = !root || clearing || destroyed;
    explanation.textContent = sessionOnly ? "Cover storage is unavailable. Covers work for this session and will regenerate after reloading."
      : root ? "Cached covers are disposable. Clearing them regenerates covers as cards approach the viewport; reading data and comic files stay unchanged."
        : "Connect a library to clear its cached covers.";
  }
  function release(view: CoverCard): void {
    if (view.url) URL.revokeObjectURL(view.url);
    view.url = null; view.cover.querySelector("img")?.remove();
    view.cover.classList.remove("has-cover");
  }
  function detach(): void {
    observer?.disconnect(); observer = null;
    for (const view of cards.values()) release(view);
    cards.clear(); queue = [];
  }
  function valid(job: CoverJob): boolean {
    return !destroyed && !job.signal.aborted && generation === job.generation && root === job.root;
  }
  function state(view: CoverCard, value: "placeholder" | "loading" | "ready" | "failed"): void {
    view.card.dataset.coverState = value;
    view.status.textContent = value === "loading" ? "Loading cover" : value === "failed" ? "Cover unavailable" : "";
    view.retry.hidden = value !== "failed";
    view.cover.setAttribute("aria-busy", String(value === "loading"));
  }
  function display(view: CoverCard, record: CoverThumbnailRecord): void {
    if (!view.near || !visible || !view.card.isConnected) return;
    release(view);
    const image = document.createElement("img"); image.alt = ""; image.decoding = "async";
    image.width = record.width; image.height = record.height;
    const url = URL.createObjectURL(record.blob); view.url = url;
    image.addEventListener("load", () => {
      if (view.url !== url || !cards.has(view.card)) return;
      view.cover.classList.add("has-cover"); state(view, "ready");
    }, { once: true });
    image.addEventListener("error", () => {
      if (view.url !== url || !cards.has(view.card)) return;
      release(view); failures.add(view.series.id); state(view, "failed");
      console.warn("Cached cover image could not be displayed", view.series.name);
    }, { once: true });
    view.cover.append(image); image.src = url;
  }
  function request(view: CoverCard): void {
    if (!root || clearing || !visible || !view.near || view.url || failures.has(view.series.id)) return;
    state(view, "loading");
    if ((running && valid(running) && running.series.id === view.series.id) || queue.some(job => job.series.id === view.series.id)) return;
    queue.push({ series: view.series, root, generation, signal: controller.signal });
    pump();
  }
  function pump(): void {
    if (running || clearing || destroyed || !visible) return;
    queue = queue.filter(job => valid(job) && [...cards.values()].some(view => view.series.id === job.series.id && view.near));
    // Prefer cards inside the viewport over cards in the preload margin.
    const distance = (job: CoverJob): number => {
      const view = [...cards.values()].find(v => v.series.id === job.series.id);
      if (!view) return Infinity;
      const r = view.card.getBoundingClientRect(); return Math.max(r.top - innerHeight, -r.bottom, 0);
    };
    queue.sort((a, b) => distance(a) - distance(b));
    const job = queue.shift(); if (!job) return;
    running = job;
    void load(job).catch(error => {
      if (!valid(job)) return;
      failures.add(job.series.id);
      console.warn("Unable to generate local series cover", job.series.name, error);
      for (const view of cards.values()) if (view.series.id === job.series.id) state(view, "failed");
    }).finally(() => { running = null; pump(); });
  }
  async function load(job: CoverJob): Promise<void> {
    const chapter = job.series.chapters[0]; if (!chapter) return;
    const remembered = validated.get(job.series.id);
    let record = await cache.get(job.root.name, job.series.id);
    if (!valid(job)) return;
    if (!record || !remembered || !matchesSource(record, remembered)) {
      const file = await new Promise<File>((resolve, reject) => {
        const abort = (): void => reject(new DOMException("Cover cancelled", "AbortError"));
        if (job.signal.aborted) { abort(); return; }
        job.signal.addEventListener("abort", abort, { once: true });
        void chapter.fileHandle.getFile().then(resolve, reject).finally(() => job.signal.removeEventListener("abort", abort));
      });
      if (!valid(job)) return;
      const source: CoverSource = { sourceChapterId: chapter.id, sourceFilename: chapter.name, sourceSize: file.size, sourceLastModified: file.lastModified };
      if (!record || !matchesSource(record, source)) {
        const thumbnail = await generateCover(file, job.signal);
        if (!valid(job)) return;
        record = { libraryName: job.root.name, seriesId: job.series.id, seriesName: job.series.name, ...source, ...thumbnail, updatedAt: Date.now() };
        await cache.put(record, () => valid(job));
      }
      if (!valid(job)) return;
      validated.set(job.series.id, source);
    }
    for (const view of cards.values()) if (view.series.id === job.series.id) display(view, record);
  }
  function observe(): void {
    if (!visible || destroyed) return;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const view = cards.get(entry.target); if (!view) continue;
          view.near = entry.isIntersecting;
          if (view.near) request(view);
          else { release(view); if (!failures.has(view.series.id)) state(view, "placeholder"); }
        }
      }, { rootMargin: "600px 0px" });
      for (const view of cards.values()) observer.observe(view.card);
    } else refreshFallback();
  }
  function refreshFallback(): void {
    if (typeof IntersectionObserver === "function" || !visible) return;
    for (const view of cards.values()) {
      const rect = view.card.getBoundingClientRect(); view.near = rect.height > 0 && rect.top <= innerHeight + 600 && rect.bottom >= -600;
      if (view.near) request(view); else release(view);
    }
  }
  function bind(series: ComicSeries[], grid: HTMLElement): void {
    detach();
    for (const card of grid.querySelectorAll<HTMLElement>(".real-comic-card")) {
      const item = series.find(s => s.id === card.dataset.seriesId); if (!item) continue;
      const view: CoverCard = { series: item, card, cover: card.querySelector<HTMLElement>(".cover-placeholder")!, status: card.querySelector<HTMLElement>(".cover-status")!, retry: card.querySelector<HTMLButtonElement>(".cover-retry")!, near: false, url: null };
      cards.set(card, view); state(view, failures.has(item.id) ? "failed" : "placeholder");
      view.retry.onclick = async () => {
        const currentRoot = root; const currentGeneration = generation;
        if (!currentRoot || clearing) return;
        if (document.activeElement === view.retry) card.querySelector<HTMLButtonElement>(".series-open")!.focus();
        failures.delete(item.id); validated.delete(item.id); release(view); state(view, "loading");
        await cache.delete(currentRoot.name, item.id);
        if (root === currentRoot && generation === currentGeneration && cards.has(card)) request(view);
      };
    }
    observe();
  }
  function reset(nextRoot: FileSystemDirectoryHandle | null): void {
    generation++; controller.abort(); controller = new AbortController();
    for (const view of cards.values()) state(view, "placeholder");
    detach(); root = nextRoot; validated.clear(); failures.clear(); settings();
  }
  async function prune(series: ComicSeries[]): Promise<void> {
    const currentRoot = root; const version = generation;
    if (currentRoot) await cache.prune(currentRoot.name, new Set(series.map(s => s.id)), () => root === currentRoot && generation === version);
  }
  clearButton.addEventListener("click", async () => {
    const currentRoot = root; if (!currentRoot || clearing) return;
    clearing = true; reset(currentRoot);
    try { await cache.clear(currentRoot.name); notify("Cached covers cleared. Covers regenerate as cards approach the viewport."); }
    finally { clearing = false; settings(); }
    // The library owns card creation; this event asks it to rebind current cards.
    clearButton.dispatchEvent(new Event("covers-cleared"));
  });
  function setVisible(value: boolean): void {
    if (visible === value) return;
    visible = value; observer?.disconnect(); observer = null; queue = [];
    for (const view of cards.values()) { view.near = false; if (!value) release(view); }
    if (value) observe();
  }
  window.addEventListener("scroll", refreshFallback, { passive: true }); window.addEventListener("resize", refreshFallback);
  const destroy = (): void => { if (destroyed) return; reset(null); destroyed = true; window.removeEventListener("scroll", refreshFallback); window.removeEventListener("resize", refreshFallback); settings(); };
  settings(); return { bind, reset, prune, setVisible, destroy };
}
