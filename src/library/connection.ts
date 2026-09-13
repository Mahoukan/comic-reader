import { checkFolderAvailable, checkReadPermission, chooseFolder, requestReadPermission, supportsFolderAccess } from "./folder-access";
import { getSavedFolder, removeSavedFolder, saveFolder } from "../storage/database";

type ConnectionState = "unsupported" | "disconnected" | "connected" | "permission" | "denied" | "unavailable" | "restoring";
export interface LibraryConnection {
  state: ConnectionState;
  handle: FileSystemDirectoryHandle | null;
  revision: number;
  busy: boolean;
}

export function initializeLibraryConnection(
  notify: (message: string) => void,
  onChange: (connection: LibraryConnection) => void,
): { reportAccessFailure: (root: FileSystemDirectoryHandle, error: unknown) => Promise<void> } {
  let handle: FileSystemDirectoryHandle | null = null;
  let state: ConnectionState = supportsFolderAccess() ? "restoring" : "unsupported";
  let revision = 0;
  let busy = false;
  let storageMessage = "";
  let actionMessage = "";
  const dialog = document.querySelector<HTMLDialogElement>("#disconnect-dialog")!;
  const chooseButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-folder-choose]"));
  const reconnectButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-folder-reconnect]"));
  const disconnectButton = document.querySelector<HTMLButtonElement>("#disconnect-folder-button")!;

  function render(): void {
    const statuses: Record<ConnectionState, string> = {
      unsupported: "Folder access unavailable", disconnected: "No library connected.",
      connected: "Connected", permission: "Reconnect folder", denied: "Permission denied",
      unavailable: "Folder no longer available", restoring: "Restoring saved folder…",
    };
    const descriptions: Record<ConnectionState, string> = {
      unsupported: "Persistent local folder access requires a compatible Chromium-based browser such as desktop Chrome or Edge.",
      disconnected: "Choose a comic-library folder. Access is read-only and stays on this device.",
      connected: "Read-only folder access. Reading and chapter continuation happen locally on this device.",
      permission: "Your saved folder needs read permission. Click Reconnect folder to continue.",
      denied: "Read permission was denied. You can reconnect to try again or choose another folder.",
      unavailable: "The saved folder could not be opened. Check that it is still available or choose another folder.",
      restoring: "Checking the saved folder without requesting permission.",
    };
    document.querySelectorAll<HTMLElement>("[data-folder-status]").forEach(element => element.textContent = statuses[state]);
    document.querySelectorAll<HTMLElement>("[data-folder-name]").forEach(element => element.textContent = handle?.name ?? "Local library");
    document.querySelectorAll<HTMLElement>("[data-folder-description]").forEach(element => {
      element.textContent = [descriptions[state], storageMessage, actionMessage].filter(Boolean).join(" ");
    });
    const reconnect = Boolean(handle) && ["permission", "denied", "unavailable"].includes(state);
    chooseButtons.forEach(button => {
      button.disabled = busy || state === "restoring" || state === "unsupported";
      button.textContent = button.id === "folder-button" && state === "connected"
        ? handle!.name : button.id === "folder-button" && reconnect
          ? "Reconnect folder" : handle ? "Change folder" : "Choose library folder";
    });
    reconnectButtons.forEach(button => {
      button.hidden = !reconnect;
      button.disabled = busy;
    });
    disconnectButton.hidden = !handle;
    disconnectButton.disabled = busy;
    document.querySelector<HTMLButtonElement>("#confirm-disconnect")!.disabled = busy;
    onChange({ state, handle, revision, busy });
  }

  async function inspectFolder(permission: PermissionState): Promise<void> {
    if (permission !== "granted") {
      state = permission === "denied" ? "denied" : "permission";
      return;
    }
    try {
      await checkFolderAvailable(handle!);
      state = "connected";
      revision++;
    } catch (error) {
      console.warn("Unable to access library folder", error);
      // Permission can change after the initial query.
      const current = await checkReadPermission(handle!).catch(() => null);
      state = current === "denied" ? "denied" : current === "prompt" ? "permission" : "unavailable";
    }
  }

  async function choose(): Promise<void> {
    if (busy || state === "restoring" || state === "unsupported") return;
    busy = true;
    actionMessage = "";
    render();
    try {
      // No asynchronous work precedes the picker: preserve the click's activation.
      const selected = await chooseFolder();
      if (!selected) return;
      handle = selected;
      state = "restoring";
      render();
      try { await inspectFolder(await checkReadPermission(handle)); }
      catch (error) {
        console.warn("Unable to check selected library folder", error);
        state = "unavailable";
      }
      render();
      try {
        await saveFolder(handle);
        storageMessage = "";
      } catch (error) {
        console.warn("Unable to save library folder", error);
        storageMessage = "This folder could not be saved. Choose it again next session; an earlier saved folder may still restore.";
      }
    } catch (error) {
      console.warn("Unable to choose library folder", error);
      actionMessage = "The folder could not be selected. Please try again.";
      notify(actionMessage);
    } finally { busy = false; render(); }
  }

  async function reconnect(): Promise<void> {
    if (!handle || busy) return;
    busy = true;
    actionMessage = "";
    state = "permission";
    render();
    try {
      // Permission is requested only from this click handler.
      await inspectFolder(await requestReadPermission(handle));
    } catch (error) {
      console.warn("Unable to reconnect library folder", error);
      state = error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "unavailable";
    } finally { busy = false; render(); }
  }

  chooseButtons.forEach(button => button.addEventListener("click", () => {
    if (button.id === "folder-button" && handle && ["permission", "denied", "unavailable"].includes(state)) void reconnect();
    else void choose();
  }));
  reconnectButtons.forEach(button => button.addEventListener("click", () => void reconnect()));
  disconnectButton.addEventListener("click", () => dialog.showModal());
  document.querySelector("#cancel-disconnect")!.addEventListener("click", () => dialog.close());
  document.querySelector("#confirm-disconnect")!.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    render();
    try {
      let removalFailed = false;
      try { await removeSavedFolder(); }
      catch (error) {
        console.warn("Unable to remove saved library folder", error);
        removalFailed = true;
      }
      handle = null;
      state = "disconnected";
      storageMessage = actionMessage = "";
      if (removalFailed) storageMessage = "Disconnected for this session. Storage is unavailable, so the earlier saved folder may restore next time.";
      dialog.close();
      notify(removalFailed ? "Folder disconnected for this session. Its saved connection could not be removed." : "Folder disconnected. Local files are unchanged.");
    } catch (error) {
      console.warn("Unable to disconnect saved library folder", error);
      actionMessage = "The saved connection could not be removed. Please retry disconnecting.";
      dialog.close();
      notify(actionMessage);
    } finally { busy = false; render(); }
  });

  const controller = {
    async reportAccessFailure(root: FileSystemDirectoryHandle, error: unknown): Promise<void> {
      const currentRevision = revision;
      const permission = await checkReadPermission(root).catch(() => null);
      if (handle !== root || revision !== currentRevision || state !== "connected") return;
      if (permission === "denied") state = "denied";
      else if (permission === "prompt") state = "permission";
      else if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) state = "permission";
      else state = "unavailable";
      render();
    },
  };
  render();
  if (state !== "unsupported") void (async () => {
    try {
      handle = await getSavedFolder();
      if (handle) {
        try { await inspectFolder(await checkReadPermission(handle)); }
        catch (error) { console.warn("Unable to restore library folder", error); state = "unavailable"; }
      } else state = "disconnected";
    } catch (error) {
      console.warn("Unable to load saved library folder", error);
      state = "disconnected";
      storageMessage = "Saved folder storage is unavailable. You can still choose a folder for this session.";
    } finally { render(); }
  })();
  return controller;
}
