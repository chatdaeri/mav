// Carry out a clicked Markdown link (see `mdLinkTarget.ts` for the rules).
// Loaded lazily from the live-preview click handler so the editor extension
// itself never imports the store.

import * as ipc from "../ipc";
import { useStore } from "../../store";
import { mdLinkAction } from "./mdLinkTarget";

export async function openMdLink(href: string): Promise<void> {
  const s = useStore.getState();
  const action = mdLinkAction(href, s.openNote?.path ?? null, s.vault?.path ?? null);
  switch (action.kind) {
    case "external":
      await ipc.openExternal(action.url);
      return;
    case "os-path":
      await ipc.openInFileManager(action.path);
      return;
    case "open":
      await s.openNoteByPath(action.path);
      return;
    case "reveal":
      if (action.path) s.requestReveal(action.path);
      return;
    case "none":
      return;
  }
}
