// Store-free helpers the editor extensions import directly (마브 side pane).

/** Ask the app-wide link menu (`LinkContextMenu`) to open at the pointer. */
export function requestLinkMenu(href: string, from: string | null, x: number, y: number): void {
  window.dispatchEvent(new CustomEvent("mav-link-menu", { detail: { href, from, x, y } }));
}

/** The side-pane file a click happened in, or null for the main editor. */
export function splitPathOf(el: EventTarget | null): string | null {
  return (el as HTMLElement | null)?.closest?.<HTMLElement>("[data-split-path]")?.dataset.splitPath ?? null;
}
