export function supportsFolderAccess(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error("Folder access is unsupported.");
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export function checkReadPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.queryPermission({ mode: "read" });
}

export function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.requestPermission({ mode: "read" });
}

// Resolving the folder against itself checks availability without enumerating files.
export async function checkFolderAvailable(handle: FileSystemDirectoryHandle): Promise<void> {
  if (await handle.resolve(handle) === null) throw new Error("Folder is unavailable.");
}
