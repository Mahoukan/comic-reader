import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { initializeLibraryConnection } from "./library/connection";
import { initializeLibraryView } from "./library/library-view";

type ViewName = "library" | "reader" | "settings";

const views = Array.from(document.querySelectorAll<HTMLElement>("[data-view]"));
const navigationButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-view-target]"),
);
const toast = document.querySelector<HTMLDivElement>("#toast");

function showView(name: ViewName): void {
  libraryView.resetDetail();
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

function showToast(message: string): void {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

const libraryView = initializeLibraryView(
  () => showView("reader"),
  (root, error) => libraryConnection.reportAccessFailure(root, error),
);
const libraryConnection = initializeLibraryConnection(showToast, libraryView.updateConnection);

registerSW({
  onOfflineReady() {
    showToast("Comic Reader is ready to use offline.");
  },
  onNeedRefresh() {
    showToast("An update is ready. Reopen the app to apply it.");
  },
});
