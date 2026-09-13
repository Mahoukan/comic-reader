import type { ReadingData } from "../storage/reading-data";
import type { ReaderPreferences } from "../storage/reader-preferences";

export function initializeReaderSettings(data: ReadingData, prepareReplacement: () => Promise<void>, notify: (message: string) => void): void {
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-preference]")];
  function sync(): void {
    for (const control of controls) {
      control.disabled = data.busy;
      const key = control.dataset.preference as keyof ReaderPreferences;
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(data.preferences[key]);
      else control.value = String(data.preferences[key]);
    }
    document.querySelector<HTMLOutputElement>("#settings-zoom-output")!.value = `${data.preferences.zoom}%`;
  }
  for (const control of controls) control.addEventListener(control instanceof HTMLInputElement && control.type === "range" ? "input" : "change", () => {
    const key = control.dataset.preference as keyof ReaderPreferences;
    const value = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : key === "zoom" ? Number(control.value) : control.value;
    data.setPreferences({ [key]: value });
  });
  data.subscribe(sync); sync();
  const dialog = document.querySelector<HTMLDialogElement>("#clear-reading-dialog")!;
  const open = document.querySelector<HTMLButtonElement>("#clear-reading-button")!;
  const confirm = document.querySelector<HTMLButtonElement>("#confirm-clear-reading")!;
  const syncClear = (): void => { open.disabled = confirm.disabled = !data.available || data.busy; };
  data.subscribe(syncClear); syncClear();
  open.addEventListener("click", () => dialog.showModal());
  document.querySelector("#cancel-clear-reading")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (open.disabled) document.querySelector<HTMLElement>("#settings-title")!.focus(); else open.focus(); });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      data.invalidatePending(); await prepareReplacement(); await data.clear();
      notify("Reading data cleared. Preferences reset.");
    } catch (error) { notify(error instanceof Error ? error.message : "Reading data could not be cleared."); }
    finally { syncClear(); dialog.close(); }
  });
}
