import type { ReadingData } from "../storage/reading-data";
import { downloadBackup, MAX_BACKUP_BYTES, parseBackup, type ReadingBackup } from "../storage/reading-backup";

export function initializeBackupSettings(
  data: ReadingData,
  activeLibrary: () => FileSystemDirectoryHandle | null,
  prepareReplacement: () => Promise<void>,
  notify: (message: string) => void,
) {
  const exportButton = document.querySelector<HTMLButtonElement>("#export-reading-button")!;
  const importButton = document.querySelector<HTMLButtonElement>("#import-reading-button")!;
  const input = document.querySelector<HTMLInputElement>("#reading-backup-file")!;
  const error = document.querySelector<HTMLElement>("#backup-error")!;
  const explanation = document.querySelector<HTMLElement>("#backup-explanation")!;
  const dialog = document.querySelector<HTMLDialogElement>("#import-reading-dialog")!;
  const mismatch = document.querySelector<HTMLInputElement>("#confirm-library-mismatch")!;
  const mismatchLabel = document.querySelector<HTMLElement>("#library-mismatch-label")!;
  const confirm = document.querySelector<HTMLButtonElement>("#confirm-import-reading")!;
  let selection = 0;
  let preview: { backup: ReadingBackup; root: FileSystemDirectoryHandle } | null = null;
  let importing = false;
  function refresh(): void {
    const root = activeLibrary();
    const disabled = !root || !data.available || data.busy || importing;
    exportButton.disabled = importButton.disabled = input.disabled = disabled;
    explanation.textContent = !data.available ? "Backups require working device storage. Reading remains available." : !root ? "Connect a library before exporting or importing its reading data." : "Backups contain only reading metadata and preferences. Import replaces this library's saved data.";
    confirm.disabled = !preview || preview.root !== root || !data.available || data.busy || importing || (preview.backup.libraryName !== root?.name && !mismatch.checked);
  }
  function showError(value: unknown): void { error.textContent = value instanceof Error ? value.message : "Reading backup could not be processed."; error.hidden = false; }
  data.subscribe(refresh);
  exportButton.addEventListener("click", () => {
    const root = activeLibrary(); if (!root || !data.available || data.busy) return;
    error.hidden = true;
    try { data.flushPreferences(); downloadBackup(data.backup(root.name)); notify("Reading backup exported."); } catch (details) { showError(details); }
  });
  importButton.addEventListener("click", () => { error.hidden = true; input.value = ""; input.click(); });
  input.addEventListener("change", async () => {
    error.hidden = true;
    const operation = ++selection;
    const root = activeLibrary(); const files = input.files;
    if (!files?.length) return;
    try {
      if (!root || !data.available || data.busy) throw new Error("Connect a library with working storage before importing.");
      if (files.length !== 1) throw new Error("Choose one JSON backup file.");
      const file = files[0]!;
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds the 5 MiB limit.");
      const backup = parseBackup(await file.text());
      if (operation !== selection || root !== activeLibrary() || !data.available || data.busy) return;
      preview = { backup, root };
      mismatch.checked = false; mismatchLabel.hidden = backup.libraryName === root.name;
      document.querySelector("#import-reading-summary")!.textContent = `Backup library: ${backup.libraryName}. Connected library: ${root.name}. Replace saved data with ${backup.progress.length} progress records, ${backup.bookmarks.length} bookmarks, ${backup.readStatuses.length} manual read states, and reader preferences. Comic files and the folder connection stay unchanged.`;
      refresh(); dialog.showModal();
    } catch (details) { if (operation === selection) showError(details); }
    finally { input.value = ""; }
  });
  mismatch.addEventListener("change", refresh);
  document.querySelector("#cancel-import-reading")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (importing) event.preventDefault(); });
  dialog.addEventListener("close", () => { preview = null; selection++; refresh(); if (importButton.disabled) document.querySelector<HTMLElement>("#settings-title")!.focus(); else importButton.focus(); });
  confirm.addEventListener("click", async () => {
    const current = preview;
    if (!current || current.root !== activeLibrary() || confirm.disabled) return;
    importing = true; refresh();
    document.querySelector<HTMLButtonElement>("#cancel-import-reading")!.disabled = true;
    try {
      data.invalidatePending();
      await prepareReplacement();
      if (current.root !== activeLibrary()) throw new Error("The connected library changed. Choose the backup again.");
      await data.replace(current.backup, current.root.name);
      notify("Reading backup imported.");
    } catch (details) { showError(details); }
    finally {
      importing = false; document.querySelector<HTMLButtonElement>("#cancel-import-reading")!.disabled = false;
      dialog.close(); refresh();
    }
  });
  refresh(); return { refresh };
}
