// Carry out a clicked Markdown link (see `mdLinkTarget.ts` for the rules).
// Loaded lazily from the live-preview / table click handlers so the editor
// extensions never import the store.
//
// Where a vault file opens (마브):
//   "split"   — the read-only side pane (a plain click; the default)
//   "current" — in place of the current tab
//   "tab"     — a new tab (Cmd/Ctrl+click)

import * as ipc from "../ipc";
import { useStore } from "../../store";
import { mdLinkAction } from "./mdLinkTarget";

export type LinkTarget = "split" | "current" | "tab";

export interface OpenLinkOptions {
  /** The file holding the link (relative links resolve against its folder).
   *  Defaults to the note in the main editor. */
  from?: string | null;
  target?: LinkTarget;
}

/** Where `href` points, resolved against `from` (or the open note). */
export function linkAction(href: string, from?: string | null) {
  const s = useStore.getState();
  return mdLinkAction(href, from ?? s.openNote?.path ?? null, s.vault?.path ?? null);
}

export async function openMdLink(href: string, opts: OpenLinkOptions = {}): Promise<void> {
  const s = useStore.getState();
  const action = linkAction(href, opts.from);
  switch (action.kind) {
    case "external":
      await ipc.openExternal(action.url);
      return;
    case "os-path":
      await ipc.openInFileManager(action.path);
      return;
    case "open": {
      const target = opts.target ?? "split";
      if (target === "split") s.openSplit(action.path);
      else if (target === "current") await s.openInCurrentTab(action.path);
      else await s.openNoteByPath(action.path);
      return;
    }
    case "reveal":
      if (action.path) s.requestReveal(action.path);
      return;
    case "none":
      return;
  }
}

export { requestLinkMenu, splitPathOf } from "./linkEvents";
