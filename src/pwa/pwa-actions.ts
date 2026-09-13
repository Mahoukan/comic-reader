import { registerSW } from "virtual:pwa-register";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function initializePwaActions(beforeReload: () => Promise<void>, notify: (message: string) => void) {
  const install = document.querySelector<HTMLButtonElement>("#install-app")!;
  const update = document.querySelector<HTMLButtonElement>("#update-app")!;
  const notice = document.querySelector<HTMLElement>("#pwa-update-notice")!;
  const message = document.querySelector<HTMLElement>("#pwa-update-message")!;
  const updateNow = document.querySelector<HTMLButtonElement>("#pwa-update-now")!;
  const later = document.querySelector<HTMLButtonElement>("#pwa-update-later")!;
  const standalone = window.matchMedia("(display-mode: standalone)");
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let deferredInstall: InstallPrompt | null = null;
  let installed = Boolean((navigator as Navigator & { standalone?: boolean }).standalone) || standalone.matches;
  let installDismissed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let waiting = false;
  let activated = false;
  let dismissed = false;
  let requested = false;
  let reloading = false;
  let timer = 0;
  let destroyed = false;

  function syncInstall(): void {
    install.hidden = destroyed || installed || standalone.matches || installDismissed || !deferredInstall;
  }
  function syncUpdate(): void {
    update.hidden = !waiting && !activated;
    update.disabled = updateNow.disabled = requested || reloading;
    later.disabled = reloading;
  }
  function showUpdate(text = "A new version of Comic Reader is ready. Update when you are ready to reload."): void {
    if (destroyed) return;
    message.textContent = text;
    if (!dismissed) notice.hidden = false;
    syncUpdate();
  }
  function updateFailed(error: unknown): void {
    if (destroyed) return;
    window.clearTimeout(timer); timer = 0;
    requested = false; reloading = false;
    console.warn("Comic Reader update could not be applied", error);
    showUpdate("The update could not be applied. You can keep reading and try Update now again later.");
    notify("The app could not update. Reading remains available.");
  }
  async function reloadWhenReady(): Promise<void> {
    if (!requested || !activated || reloading || destroyed) return;
    window.clearTimeout(timer); timer = 0;
    reloading = true; syncUpdate();
    message.textContent = "Saving your reading position before reloading…";
    try {
      await beforeReload();
      if (!destroyed && requested) window.location.reload();
    } catch (error) { updateFailed(error); }
  }
  function restoreNoticeFocus(): void {
    if (!notice.contains(document.activeElement)) return;
    const reader = document.querySelector<HTMLElement>('[data-view="reader"]')!;
    const target = !reader.hidden ? document.querySelector<HTMLElement>("#pages")!
      : [...document.querySelectorAll<HTMLElement>(".nav-button.active")].find(button => button.getClientRects().length > 0);
    target?.focus({ preventScroll: true });
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (installed || standalone.matches || installDismissed) return;
    deferredInstall = event as InstallPrompt; syncInstall();
  }, { signal });
  window.addEventListener("appinstalled", () => {
    installed = true; deferredInstall = null; syncInstall();
  }, { signal });
  standalone.addEventListener("change", syncInstall, { signal });
  install.addEventListener("click", async () => {
    const prompt = deferredInstall;
    if (!prompt || installed || standalone.matches) return;
    const hadFocus = document.activeElement === install;
    deferredInstall = null; syncInstall();
    try {
      // Invoke directly from the click to retain browser user activation.
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") installed = true;
      else installDismissed = true;
    } catch (error) {
      installDismissed = true;
      console.warn("Comic Reader installation was unavailable", error);
      if (!destroyed) notify("Installation is unavailable right now. You can keep using this browser tab.");
    } finally {
      syncInstall();
      if (hadFocus && !destroyed && !document.querySelector<HTMLElement>('[data-view="settings"]')!.hidden) document.querySelector<HTMLElement>("#app-settings-title")!.focus({ preventScroll: true });
    }
  }, { signal });

  let activateUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
  const chooseUpdate = async (): Promise<void> => {
    if (requested || reloading || (!waiting && !activated) || destroyed) return;
    dismissed = false; requested = true;
    notice.hidden = false; syncUpdate();
    if (activated) { await reloadWhenReady(); return; }
    message.textContent = "Preparing the update. Your reading session stays open until it is ready.";
    timer = window.setTimeout(() => updateFailed(new Error("Service-worker activation timed out.")), 15000);
    try {
      if (registration && !registration.waiting) throw new Error("No updated service worker is waiting.");
      if (!activateUpdate) throw new Error("Update setup is unavailable.");
      await activateUpdate();
      // The plugin's controlling event, not this promise, confirms readiness.
    } catch (error) { updateFailed(error); }
  };
  update.addEventListener("click", chooseUpdate, { signal });
  updateNow.addEventListener("click", chooseUpdate, { signal });
  later.addEventListener("click", () => {
    requested = false; dismissed = true;
    window.clearTimeout(timer); timer = 0;
    restoreNoticeFocus(); notice.hidden = true; syncUpdate();
  }, { signal });

  try {
    activateUpdate = registerSW({
      onOfflineReady: () => { if (!destroyed) notify("Comic Reader is ready to open offline."); },
      onNeedRefresh: () => { waiting = true; activated = false; showUpdate(); },
      onNeedReload: () => {
        if (destroyed) return;
        activated = true; waiting = false;
        // Another tab may activate a worker. This tab still requires consent.
        if (requested) void reloadWhenReady(); else showUpdate();
      },
      onRegisteredSW: (_url, current) => {
        registration = current;
        if (!current || destroyed) return;
        const watchInstalling = (): void => {
          const worker = current.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "redundant" && requested && !activated) updateFailed(new Error("The new service worker failed to install."));
          }, { signal });
        };
        current.addEventListener("updatefound", watchInstalling, { signal });
        watchInstalling();
      },
      onRegisterError: error => {
        console.warn("Comic Reader offline registration failed", error);
        if (!destroyed) notify("Offline setup is unavailable. You can keep using the app in this tab.");
        if (requested) updateFailed(error);
      },
    });
  } catch (error) {
    console.warn("Comic Reader offline setup failed", error);
    notify("Offline setup is unavailable. You can keep using the app in this tab.");
  }
  syncInstall(); syncUpdate();
  return {
    destroy(): void {
      destroyed = true; requested = false;
      window.clearTimeout(timer); lifetime.abort(); deferredInstall = null;
      install.hidden = update.hidden = notice.hidden = true;
    },
  };
}
