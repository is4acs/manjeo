type FocusHandlers = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
};
type FocusOrigin = {target: HTMLElement; dialog: HTMLElement | null};
// Entries live only until the corresponding close autofocus event. Keeping the
// closing entry briefly bridges a replacement whose old button just unmounted.
const origins = new Map<HTMLElement, FocusOrigin>();
const openDialog = '[role="dialog"][data-state="open"]';

function returnTarget(origin: FocusOrigin | undefined, visited = new Set<HTMLElement>()): HTMLElement | null {
  if (!origin || visited.has(origin.target)) return null;
  visited.add(origin.target);
  const {target, dialog} = origin;
  if (target.isConnected && target !== document.body && target.getClientRects().length
    && !target.matches(':disabled') && !target.closest('[inert], [aria-hidden="true"]')
    && (!dialog || dialog.dataset.state === 'open')) return target;
  // A replacement dialog may have opened from a button in the previous one.
  return dialog ? returnTarget(origins.get(dialog), visited) : null;
}

/** Restore controlled dialogs too, including those opened without a Radix Trigger. */
export function dialogFocusHandlers(handlers: FocusHandlers): Required<FocusHandlers> {
  return {
    onOpenAutoFocus(event) {
      const content = event.target;
      const target = document.activeElement;
      if (content instanceof HTMLElement && target instanceof HTMLElement && !content.contains(target)) {
        const parent = target.closest<HTMLElement>('[role="dialog"]');
        const departing = target === document.body
          ? [...origins].reverse().find(([dialog]) => !dialog.isConnected || dialog.dataset.state === 'closed')?.[1]
          : parent?.dataset.state === 'closed' ? origins.get(parent) : undefined;
        origins.set(content, departing || {target, dialog: parent});
      }
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event) {
      const content = event.target;
      const origin = content instanceof HTMLElement ? origins.get(content) : undefined;
      if (content instanceof HTMLElement) origins.delete(content);
      handlers.onCloseAutoFocus?.(event);
      if (event.defaultPrevented || !(content instanceof HTMLElement)) return;
      const active = document.activeElement;
      // A newly opened dialog already owns focus; an older one must not take it.
      if (active instanceof HTMLElement && active.closest(openDialog) && !content.contains(active)) {
        event.preventDefault(); return;
      }
      const target = returnTarget(origin);
      if (!target) return;
      const remainingDialog = [...document.querySelectorAll<HTMLElement>(openDialog)].find(dialog => dialog !== content);
      if (remainingDialog && !remainingDialog.contains(target)) { event.preventDefault(); return; }
      event.preventDefault(); target.focus();
    },
    onEscapeKeyDown(event) {
      handlers.onEscapeKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.dataset.addressSuggestions === 'open') {
        // The input then closes its suggestions in its own keyboard handler.
        event.preventDefault();
      }
    },
  };
}
