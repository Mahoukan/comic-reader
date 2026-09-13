import type { ComicChapter, ComicSeries } from "../library/library-scanner";
import { openChapter, type OpenedChapter } from "./cbz-reader";

export type ChapterState = "opening" | "ready" | "rendering" | "failed" | "closed";

export interface SessionChapter {
  chapter: ComicChapter;
  index: number;
  state: ChapterState;
  archive: OpenedChapter | null;
  controller: AbortController;
  urls: Set<string>;
  attempt: number;
  operation: Promise<void> | null;
}

interface SessionEvents {
  mounted(chapter: SessionChapter): void;
  changed(chapter: SessionChapter, error?: unknown): void;
  removed(chapter: SessionChapter): void;
  currentChanged(chapter: SessionChapter): void;
}

// Owns resources and scheduling, without knowing anything about the DOM.
export class ReadingSession {
  readonly series: ComicSeries;
  readonly startIndex: number;
  currentIndex: number;
  generation = 0;
  private readonly chapters = new Map<number, SessionChapter>();
  private opening: Promise<void> = Promise.resolve();
  private cleanup: Promise<void> = Promise.resolve();
  private extraction: Promise<void> | null = null;
  private queue: { chapter: SessionChapter; run: () => Promise<void> }[] = [];
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(series: ComicSeries, start: ComicChapter, private readonly events: SessionEvents) {
    this.series = series;
    this.startIndex = series.chapters.findIndex(chapter => chapter.id === start.id);
    if (this.startIndex < 0) throw new Error("Chapter does not belong to this series.");
    this.currentIndex = this.startIndex;
  }

  get mounted(): SessionChapter[] {
    return [...this.chapters.values()].sort((a, b) => a.index - b.index);
  }

  get currentChapter(): ComicChapter {
    return this.series.chapters[this.currentIndex];
  }

  isActive(chapter: SessionChapter): boolean {
    return !this.closed && this.chapters.get(chapter.index) === chapter && chapter.state !== "closed";
  }

  start(): Promise<void> {
    return this.ensureChapter(this.startIndex);
  }

  prepareNext(index: number): Promise<void> {
    if (this.closed || index !== this.currentIndex || index + 1 >= this.series.chapters.length) return Promise.resolve();
    const current = this.chapters.get(index);
    if (!current || !["ready", "rendering"].includes(current.state)) return Promise.resolve();
    return this.ensureChapter(index + 1);
  }

  retry(chapter: SessionChapter): Promise<void> {
    if (!this.isActive(chapter) || chapter.state !== "failed") return Promise.resolve();
    return this.ensureChapter(chapter.index, true);
  }

  setCurrent(index: number): boolean {
    const chapter = this.chapters.get(index);
    if (!chapter || !this.isActive(chapter) || !["ready", "rendering"].includes(chapter.state)) return false;
    if (index === this.currentIndex) return true;
    this.currentIndex = index;
    // A deliberate backward crossing also releases anything beyond its next chapter.
    for (const mounted of this.mounted) {
      if (mounted.index < index - 1 || mounted.index > index + 1) this.release(mounted);
    }
    this.events.currentChanged(chapter);
    return true;
  }

  private ensureChapter(index: number, retry = false): Promise<void> {
    if (this.closed || index < this.startIndex || Math.abs(index - this.currentIndex) > 1) return Promise.resolve();
    let chapter = this.chapters.get(index);
    if (chapter && !retry) return chapter.operation ?? Promise.resolve();
    if (!chapter) {
      chapter = {
        chapter: this.series.chapters[index], index, state: "opening", archive: null,
        controller: new AbortController(), urls: new Set(), attempt: 0, operation: null,
      };
      this.chapters.set(index, chapter);
      this.events.mounted(chapter);
    } else {
      chapter.controller.abort();
      chapter.controller = new AbortController();
      chapter.state = "opening";
      this.events.changed(chapter);
    }
    const active = chapter;
    const attempt = ++active.attempt;
    this.opening = this.opening.catch(() => {}).then(async () => {
      // Wait for evicted readers to close before opening another archive.
      await this.cleanup;
      if (!this.isActive(active) || active.attempt !== attempt) return;
      try {
        const archive = await openChapter(active.chapter.fileHandle, active.controller.signal);
        if (!this.isActive(active) || active.attempt !== attempt) { await archive.close(); return; }
        active.archive = archive;
        active.state = "ready";
        this.events.changed(active);
      } catch (error) {
        if (!this.isActive(active) || active.controller.signal.aborted || active.attempt !== attempt) return;
        active.state = "failed";
        this.events.changed(active, error);
      }
    });
    active.operation = this.opening;
    return active.operation;
  }

  enqueue(chapter: SessionChapter, run: () => Promise<void>): void {
    if (!this.isActive(chapter) || !chapter.archive) return;
    this.queue.push({ chapter, run });
    this.pump();
  }

  private pump(): void {
    if (this.extraction) return;
    const operation = (async () => {
      while (this.queue.length && !this.closed) {
        const task = this.queue.shift()!;
        if (!this.isActive(task.chapter)) continue;
        try { await task.run(); }
        catch (error) { console.warn("Unexpected page rendering failure", error); }
      }
    })();
    this.extraction = operation;
    void operation.then(() => {
      this.extraction = null;
      if (this.queue.length && !this.closed) this.pump();
    });
  }

  createURL(chapter: SessionChapter, blob: Blob): string | null {
    if (!this.isActive(chapter)) return null;
    const url = URL.createObjectURL(blob);
    chapter.urls.add(url);
    return url;
  }

  revokeURL(chapter: SessionChapter, url: string): void {
    URL.revokeObjectURL(url);
    chapter.urls.delete(url);
  }

  private release(chapter: SessionChapter): void {
    chapter.state = "closed";
    chapter.controller.abort();
    this.chapters.delete(chapter.index);
    this.queue = this.queue.filter(task => task.chapter !== chapter);
    this.events.removed(chapter);
    for (const url of chapter.urls) URL.revokeObjectURL(url);
    chapter.urls.clear();
    const archive = chapter.archive;
    chapter.archive = null;
    this.cleanup = Promise.all([this.cleanup, archive?.close().catch(error => console.warn("Unable to close chapter", error))]).then(() => {});
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.generation++;
    this.queue = [];
    for (const chapter of this.mounted) this.release(chapter);
    this.closing = Promise.allSettled([this.opening, this.cleanup, this.extraction]).then(() => {});
    return this.closing;
  }
}
