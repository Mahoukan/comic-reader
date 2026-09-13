import { ReadingData } from "./storage/reading-data";
import { initializeReaderSettings } from "./reader/reader-settings";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { initializeLibraryConnection } from "./library/connection";
import { initializeLibraryView } from "./library/library-view";
import { initializeReaderView } from "./reader/reader-view";
import { checkReadPermission } from "./library/folder-access";
import type { LibraryConnection } from "./library/connection";

type ViewName = "library" | "reader" | "settings";

async function start(): Promise<void> {
  const views = Array.from(document.querySelectorAll<HTMLElement>("[data-view]"));
  const navigationButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view-target]"));
  const toast = document.querySelector<HTMLDivElement>("#toast");
  function showView(name: ViewName): void {
    views.forEach(view => { view.hidden = view.dataset.view !== name; });
    navigationButtons.forEach(button => {
      const active = button.dataset.viewTarget === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function showToast(message: string): void {
    if (!toast) return;
    toast.textContent = message; toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2600);
  }
  const readingData = new ReadingData(message => {
    const warning = document.querySelector<HTMLElement>("#storage-warning")!;
    warning.textContent = message; warning.hidden = false;
  });
  await readingData.initialize();
  let currentConnection: LibraryConnection | null = null;
  const readerView = initializeReaderView(
    (series, chapter) => { showView("library"); libraryView.returnToSeries(series, chapter); },
    () => {
      showView("library"); libraryView.resetDetail();
      document.querySelector<HTMLInputElement>("#library-search")!.focus();
    },
    error => {
      const root = currentConnection?.handle;
      if (!root) return;
      void checkReadPermission(root).then(permission => {
        if (permission !== "granted") return libraryConnection.reportAccessFailure(root, error);
      }).catch(details => console.warn("Unable to check folder permission", details));
    },
    readingData,
    () => currentConnection?.handle?.name ?? null,
  );
  initializeReaderSettings(readingData, () => readerView.resetReadingData());
  const libraryView = initializeLibraryView(
    () => { void readerView.close(); showView("reader"); readerView.preview(); },
    (root, error) => libraryConnection.reportAccessFailure(root, error),
    (series, chapter, position) => {
      void readerView.close(); showView("reader"); readerView.open(series, chapter, position);
    },
    readingData,
  );
  const libraryConnection = initializeLibraryConnection(showToast, connection => {
    const previous = currentConnection;
    if (previous?.handle && (connection.handle !== previous.handle || connection.state !== "connected")) {
      void readerView.close();
      if (!document.querySelector<HTMLElement>('[data-view="reader"]')!.hidden) showView("library");
    }
    currentConnection = connection;
    libraryView.updateConnection(connection);
  });
  navigationButtons.forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.viewTarget as ViewName;
    if (name === "reader") { if (!readerView.isOpen()) readerView.preview(); }
    else void readerView.close();
    if (name === "library") libraryView.resetDetail();
    showView(name);
  }));
  registerSW({
    onOfflineReady() { showToast("Comic Reader is ready to use offline."); },
    onNeedRefresh() { showToast("An update is ready. Reopen the app to apply it."); },
  });
}
void start();
