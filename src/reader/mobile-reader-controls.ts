// Phone overlays never change the reading line or document layout.
export function initializeMobileReaderControls(
  reader: HTMLElement,
  toolbar: HTMLElement,
  setHidden: (hidden: boolean) => void,
) {
  const phone = window.matchMedia("(max-width: 700px)");
  let active = false;
  let destroyed = false;
  let timer = 0;
  let frame = 0;
  let previousY = window.scrollY;
  let direction = 0;
  let distance = 0;
  let desktopHidden = Boolean(toolbar.hidden);
  let inPhoneMode = false;
  let interacting = false;
  let tap: { id: number; x: number; y: number; scroll: number; time: number } | null = null;
  const listeners: (() => void)[] = [];
  function listen(target: EventTarget, name: string, handler: EventListener): void {
    target.addEventListener(name, handler, { passive: true });
    listeners.push(() => target.removeEventListener(name, handler));
  }
  const enabled = (): boolean => !destroyed && active && phone.matches && !reader.hidden;
  const locked = (): boolean => interacting || toolbar.contains(document.activeElement)
    || Boolean(document.querySelector("dialog[open]"));
  function cancel(): void {
    window.clearTimeout(timer); timer = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; tap = null; interacting = false; direction = distance = 0;
  }
  function arm(): void {
    window.clearTimeout(timer); timer = 0;
    if (!enabled() || toolbar.hidden) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (enabled() && !locked()) setHidden(true);
    }, 3000);
  }
  function reveal(): void {
    if (!enabled()) return;
    setHidden(false); arm();
  }
  function modeChanged(): void {
    cancel(); previousY = window.scrollY;
    if (active && phone.matches && !inPhoneMode) {
      desktopHidden = Boolean(toolbar.hidden); inPhoneMode = true; reveal();
    } else if ((!active || !phone.matches) && inPhoneMode) {
      inPhoneMode = false;
      if (active) setHidden(desktopHidden);
    }
  }
  listen(phone, "change", modeChanged);
  listen(window, "scroll", () => {
    if (!enabled() || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - previousY; previousY = y;
      if (!delta) return;
      const nextDirection = delta > 0 ? 1 : -1;
      if (direction !== nextDirection) { distance = 0; direction = nextDirection; }
      distance += Math.abs(delta);
      if (locked()) { distance = 0; arm(); return; }
      if (direction === 1 && distance >= 12) { setHidden(true); window.clearTimeout(timer); timer = 0; }
      else if (direction === -1 && distance >= 24) { reveal(); distance = 0; }
    });
  });
  listen(reader, "pointerdown", event => {
    if (!enabled()) return;
    const pointer = event as PointerEvent;
    if (!pointer.isPrimary || pointer.button !== 0) { tap = null; return; }
    const target = pointer.target as Element;
    if (target.closest("#reader-toolbar, #show-reader-controls")) { interacting = true; arm(); return; }
    if (!target.closest("#pages") || target.closest("button, a, input, select, textarea")) return;
    interacting = false;
    // A deliberate touch of the reading area ends use of a focused control.
    if (toolbar.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    tap = { id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, scroll: window.scrollY, time: performance.now() };
  });
  listen(reader, "pointermove", event => {
    const pointer = event as PointerEvent;
    if (tap && tap.id === pointer.pointerId && Math.hypot(pointer.clientX - tap.x, pointer.clientY - tap.y) > 10) tap = null;
  });
  listen(window, "pointerup", event => {
    const pointer = event as PointerEvent;
    const candidate = tap; tap = null; interacting = false;
    if (enabled() && candidate?.id === pointer.pointerId && performance.now() - candidate.time < 500
      && Math.hypot(pointer.clientX - candidate.x, pointer.clientY - candidate.y) <= 10
      && Math.abs(window.scrollY - candidate.scroll) < 8 && !window.getSelection()?.toString()) reveal();
    else arm();
  });
  listen(window, "pointercancel", () => { tap = null; interacting = false; arm(); });
  for (const name of ["focusin", "focusout", "input", "change", "click"]) listen(toolbar, name, arm);
  listen(document, "focusin", arm);
  listen(document, "focusout", arm);
  // Dialog close is not a bubbling event.
  for (const dialog of document.querySelectorAll("dialog")) listen(dialog, "close", arm);
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") cancel();
    else if (enabled()) { previousY = window.scrollY; arm(); }
  });
  return {
    isPhone: () => phone.matches,
    interaction: arm,
    setActive(value: boolean): void {
      if (active === value) return;
      active = value; modeChanged();
    },
    restart(): void { if (enabled()) { previousY = window.scrollY; direction = distance = 0; reveal(); } },
    stop: cancel,
    destroy(): void { destroyed = true; active = false; cancel(); for (const remove of listeners) remove(); },
  };
}
