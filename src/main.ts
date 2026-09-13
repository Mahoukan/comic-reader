import "./styles.css";
import { registerSW } from "virtual:pwa-register";

type ViewName = "library" | "reader" | "settings";

const views = Array.from(document.querySelectorAll<HTMLElement>("[data-view]"));
const navigationButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-view-target]"),
);
const toast = document.querySelector<HTMLDivElement>("#toast");

function showView(name: ViewName): void {
  views.forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });

  navigationButtons.forEach((button) => {
    const isActive = button.dataset.viewTarget === name;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

navigationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.viewTarget as ViewName);
  });
});

document.querySelector("#continue-button")?.addEventListener("click", () => {
  showView("reader");
});

document.querySelectorAll<HTMLButtonElement>(".comic-card").forEach((card) => {
  card.addEventListener("click", () => showView("reader"));
});

const zoomRange = document.querySelector<HTMLInputElement>("#zoom-range");
const zoomOutput = document.querySelector<HTMLOutputElement>("#zoom-output");
const pages = document.querySelector<HTMLDivElement>("#pages");

function setZoom(value: number): void {
  if (!zoomOutput || !pages) return;
  zoomOutput.value = `${value}%`;
  pages.style.setProperty("--reader-width", `${Math.round(720 * value / 100)}px`);
}

zoomRange?.addEventListener("input", () => setZoom(Number(zoomRange.value)));

document.querySelector("#fit-width-button")?.addEventListener("click", () => {
  if (!zoomRange) return;
  zoomRange.value = "100";
  setZoom(100);
});

const searchInput = document.querySelector<HTMLInputElement>("#library-search");
const sortSelect = document.querySelector<HTMLSelectElement>("#library-sort");
const comicGrid = document.querySelector<HTMLDivElement>("#comic-grid");
const seriesCount = document.querySelector<HTMLSpanElement>("#series-count");
const emptyMessage = document.querySelector<HTMLParagraphElement>("#empty-message");

function updateLibrary(): void {
  if (!comicGrid || !seriesCount || !emptyMessage) return;

  const query = searchInput?.value.trim().toLocaleLowerCase() ?? "";
  const cards = Array.from(comicGrid.querySelectorAll<HTMLButtonElement>(".comic-card"));

  cards.sort((first, second) => {
    const sort = sortSelect?.value;
    if (sort === "title") {
      return (first.dataset.title ?? "").localeCompare(second.dataset.title ?? "", undefined, {
        numeric: true,
      });
    }
    if (sort === "progress") {
      return Number(second.dataset.progress) - Number(first.dataset.progress);
    }
    return Number(second.dataset.recent) - Number(first.dataset.recent);
  });

  let visibleCount = 0;
  cards.forEach((card) => {
    const matches = (card.dataset.title ?? "").toLocaleLowerCase().includes(query);
    card.hidden = !matches;
    if (matches) visibleCount += 1;
    comicGrid.append(card);
  });

  seriesCount.textContent = `${visibleCount} ${visibleCount === 1 ? "series" : "series"}`;
  emptyMessage.hidden = visibleCount !== 0;
}

searchInput?.addEventListener("input", updateLibrary);
sortSelect?.addEventListener("change", updateLibrary);

function showToast(message: string): void {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

document.querySelectorAll("#folder-button, #settings-folder-button").forEach((button) => {
  button.addEventListener("click", () => showToast("Local folder access is the next milestone."));
});

document.querySelector("#rescan-button")?.addEventListener("click", () => {
  showToast("Demo library refreshed.");
});

registerSW({
  onOfflineReady() {
    showToast("Comic Reader is ready to use offline.");
  },
  onNeedRefresh() {
    showToast("An update is ready. Reopen the app to apply it.");
  },
});
