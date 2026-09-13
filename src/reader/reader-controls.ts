import type { ComicChapter, ComicSeries } from "../library/library-scanner";

interface ControlActions {
  open(series: ComicSeries, chapter: ComicChapter): void;
  fitWidth(): void;
  bookmark(): void;
  layout(change: () => void): void;
  announce(message: string): void;
}

// Reader-only UI state; reading preferences and anchors retain their existing owners.
export function initializeReaderControls(actions: ControlActions) {
  const reader = document.querySelector<HTMLElement>('[data-view="reader"]')!;
  const toolbar = document.querySelector<HTMLElement>("#reader-toolbar")!;
  const hide = document.querySelector<HTMLButtonElement>("#hide-reader-controls")!;
  const show = document.querySelector<HTMLButtonElement>("#show-reader-controls")!;
  const fullscreen = document.querySelector<HTMLButtonElement>("#reader-fullscreen")!;
  const previous = document.querySelector<HTMLButtonElement>("#reader-previous")!;
  const next = document.querySelector<HTMLButtonElement>("#reader-next")!;
  const selector = document.querySelector<HTMLSelectElement>("#reader-chapter-select")!;
  const help = document.querySelector<HTMLButtonElement>("#reader-shortcuts")!;
  const dialog = document.querySelector<HTMLDialogElement>("#reader-shortcut-dialog")!;
  const closeHelp = document.querySelector<HTMLButtonElement>("#close-reader-shortcuts")!;
  let series: ComicSeries | null = null;
  let index = -1;
  let fullscreenPending = false;
  let ownsFullscreen = false;
  let returnFocus: HTMLElement | null = null;
  const listeners: (() => void)[] = [];
  const topbar = document.querySelector<HTMLElement>(".topbar")!;
  const updateInset = (): void => reader.style.setProperty("--reader-toolbar-top", `${topbar.getBoundingClientRect().height}px`);
  const topbarObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updateInset) : null;
  topbarObserver?.observe(topbar);
  function listen(target: EventTarget, type: string, callback: EventListener): void {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  }
  function syncFullscreen(): void {
    const active = document.fullscreenElement === document.documentElement;
    fullscreen.hidden = !document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== "function";
    fullscreen.disabled = fullscreenPending;
    fullscreen.textContent = active ? "Exit fullscreen" : "Fullscreen";
    fullscreen.setAttribute("aria-pressed", String(active));
    if (!document.fullscreenElement) ownsFullscreen = false;
  }
  async function toggleFullscreen(): Promise<void> {
    if (fullscreen.hidden || fullscreenPending) return;
    fullscreenPending = true; syncFullscreen();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        // Fullscreen the document so window scrolling and anchor measurements stay intact.
        ownsFullscreen = true;
        await document.documentElement.requestFullscreen();
        if (reader.hidden || !ownsFullscreen) await document.exitFullscreen();
      }
    } catch (error) {
      ownsFullscreen = false;
      console.warn("Unable to change reader fullscreen", error);
      actions.announce("Fullscreen could not be changed. You can continue reading.");
    } finally { fullscreenPending = false; syncFullscreen(); }
  }
  function setHidden(hidden: boolean, focus = true): void {
    if (toolbar.hidden === hidden) return;
    actions.layout(() => {
      toolbar.hidden = hidden;
      show.hidden = !hidden;
      hide.setAttribute("aria-expanded", String(!hidden));
      show.setAttribute("aria-expanded", String(!hidden));
      if (!hidden) toolbar.scrollTop = 0;
      if (focus) (hidden ? show : document.querySelector<HTMLButtonElement>("#reader-back-button")!).focus({ preventScroll: true });
    });
  }
  function sync(selectedSeries: ComicSeries | null, selectedChapter?: ComicChapter): void {
    if (series !== selectedSeries) {
      series = selectedSeries;
      selector.replaceChildren();
      if (series) for (const chapter of series.chapters) {
        const option = document.createElement("option");
        option.value = chapter.id; option.textContent = chapter.displayName;
        selector.append(option);
      }
      else selector.append(new Option("No chapter open", ""));
    }
    index = series && selectedChapter ? series.chapters.findIndex(chapter => chapter.id === selectedChapter.id) : -1;
    selector.disabled = index < 0;
    if (selectedChapter && index >= 0) selector.value = selectedChapter.id;
    previous.disabled = index <= 0;
    next.disabled = !series || index < 0 || index >= series.chapters.length - 1;
  }
  function navigate(offset: number): void {
    const chapter = series?.chapters[index + offset];
    if (series && index >= 0 && chapter) actions.open(series, chapter);
  }
  function openHelp(): void {
    if (dialog.open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : help;
    dialog.showModal();
  }
  listen(hide, "click", () => setHidden(true));
  listen(show, "click", () => setHidden(false));
  listen(fullscreen, "click", () => { void toggleFullscreen(); });
  listen(document, "fullscreenchange", syncFullscreen);
  listen(window, "resize", updateInset);
  listen(previous, "click", () => navigate(-1));
  listen(next, "click", () => navigate(1));
  listen(selector, "change", () => {
    const chapter = series?.chapters.find(chapter => chapter.id === selector.value);
    if (series && chapter) actions.open(series, chapter);
  });
  listen(help, "click", openHelp);
  listen(closeHelp, "click", () => dialog.close());
  listen(dialog, "close", () => {
    if (!reader.hidden) (returnFocus?.isConnected && !returnFocus.closest("[hidden]") ? returnFocus : toolbar.hidden ? show : help).focus({ preventScroll: true });
    returnFocus = null;
  });
  listen(document, "keydown", event => {
    const key = event as KeyboardEvent;
    if (reader.hidden || key.defaultPrevented || key.repeat || key.ctrlKey || key.altKey || key.metaKey || key.isComposing) return;
    const target = key.target;
    if (document.querySelector("dialog[open]") || target instanceof Element && target.closest('input, select, textarea, dialog, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    const shortcut = key.key.toLowerCase();
    const action = ({ f: () => { void toggleFullscreen(); }, w: actions.fitWidth, b: actions.bookmark,
      h: () => setHidden(!toolbar.hidden), "[": () => navigate(-1), "]": () => navigate(1), "?": openHelp } as Record<string, (() => void) | undefined>)[shortcut];
    if (action) { key.preventDefault(); action(); }
  });
  sync(null); syncFullscreen(); updateInset();
  return {
    sync,
    reset(): void {
      sync(null);
      if (dialog.open) dialog.close();
      setHidden(false, false);
    },
    leave(): void {
      if (ownsFullscreen) {
        ownsFullscreen = false;
        if (document.fullscreenElement) void document.exitFullscreen().catch(error => console.warn("Unable to exit fullscreen", error));
      }
      if (dialog.open) { returnFocus = null; dialog.close(); }
    },
    destroy(): void { this.leave(); topbarObserver?.disconnect(); for (const remove of listeners) remove(); },
  };
}
