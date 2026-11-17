/* The side-effecting half of the recovery-copy actions (the pure half is
   `recoveryCopies.ts`): open a copy or a Trash preview read-only, restore a copy over the current note (through its live editor, so
   through the CRDT) or beside it, delete a copy. */
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { noteLabel } from "../lib/notePath";
import { isNoteExt } from "../lib/formats";
import { toast } from "../lib/toast";
import { liveView, replaceWholeDoc, waitForLiveView } from "./liveEditorViews";
import {
  copyTabTitle,
  originalPathOf,
  siblingRecoveredPath,
  stampTime,
  parseTrashPath,
  type CopyRef,
} from "./recoveryCopies";
import { REVIEW_TAB_ID, textTabId, type TextSource } from "./virtualTabs";

/** How long "Replace current note" waits for the note's editor to mount. */
export const LIVE_VIEW_WAIT_MS = 8000;

const copySource = (ref: CopyRef): TextSource => ({ type: "copy", ...ref });

function copyTime(ref: CopyRef, fallback?: number): number {
  return stampTime(ref.stamp) ?? fallback ?? Date.now();
}

function show(): void {
  // The actions live in Settings → Health; what they open is behind it.
  useStore.getState().dismissSettings();
}

export function openCopy(ref: CopyRef, modified?: number): void {
  if (!isNoteExt(ref.relPath)) {
    const vault = useStore.getState().vault;
    const path = ipcTrashPath(ref);
    if (!vault || !parseTrashPath(path)) return;
    void ipc.revealInFileManager(`${vault.path}/${path}`)
      .catch(() => toast("복구 사본을 표시할 수 없어요.", "error"));
    return;
  }
  const source = copySource(ref);
  useStore.getState().openVirtualTab({
    kind: "text",
    id: textTabId(source),
    title: copyTabTitle(ref.relPath, copyTime(ref, modified)),
    subtitle: `${ipcTrashPath(ref)}`,
    source,
  });
  show();
}

export function openTrashPreview(docId: string, relPath: string): void {
  const source: TextSource = { type: "trash", docId };
  useStore.getState().openVirtualTab({
    kind: "text",
    id: textTabId(source),
    title: `${noteLabel(relPath)} (삭제됨)`,
    subtitle: "휴지통",
    source,
  });
  show();
}

export function ipcTrashPath(ref: CopyRef): string {
  return `.context/trash/${ref.stamp}/${ref.relPath}`;
}

function epoch(): ipc.VaultEpoch {
  return useStore.getState().vault?.epoch;
}

/** Open `path` (unless it is already the mounted note) and wait for its editor. */
async function liveViewFor(path: string) {
  const now = liveView(path);
  if (now) {
    useStore.getState().activateVirtualTab(null);
    return now;
  }
  await useStore.getState().openNoteByPath(path);
  const view = await waitForLiveView(path, LIVE_VIEW_WAIT_MS);
  if (!view) throw new Error("노트가 제때 열리지 않았어요. 노트를 열고 다시 시도하세요.");
  return view;
}

/**
 * Replace the note at `notePath` with `text` as ONE editor transaction on its
 * live editor. In a synced vault that goes through yCollab into the note's
 * Y.Text exactly like typing, so it merges and syncs; never a disk write.
 */
export async function replaceNoteText(notePath: string, text: string): Promise<void> {
  if (!(await ipc.noteExists(notePath, epoch()))) {
    throw new Error("해당 경로에 현재 노트가 없어요. 대신 새 노트로 복원하세요.");
  }
  const view = await liveViewFor(notePath);
  replaceWholeDoc(view, text);
}

export async function restoreCopyReplace(ref: CopyRef, notePath = originalPathOf(ref.relPath)): Promise<void> {
  if (!isNoteExt(ref.relPath)) throw new Error("파일 관리자에서 이 파일의 사본으로 복구하세요.");
  const text = await ipc.readTrashCopy(ref.stamp, ref.relPath, epoch());
  await replaceNoteText(notePath, text);
}

/** First free `<stem> (recovered…).<ext>` beside `path`, checked on disk. */
export async function freeSiblingPath(path: string): Promise<string> {
  const taken = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const candidate = siblingRecoveredPath(path, (p) => taken.has(p.toLowerCase()));
    if (!(await ipc.noteExists(candidate, epoch()))) return candidate;
    taken.add(candidate.toLowerCase());
  }
  throw new Error("복구한 노트에 쓸 수 있는 이름을 찾지 못했어요.");
}

/**
 * Create `<stem> (recovered).<ext>` beside the original with `text`: the
 * store's create action makes (and registers) an empty note and opens it, then
 * the text goes in through its live editor like any edit.
 */
export async function restoreTextAsSibling(originalPath: string, text: string): Promise<string> {
  const target = await freeSiblingPath(originalPath);
  const slash = target.lastIndexOf("/");
  const dir = slash === -1 ? "" : target.slice(0, slash);
  const name = target.slice(slash + 1);
  const created = await useStore.getState().createNoteAt(dir, name);
  if (!created) throw new Error("이 폴더에는 지금 새 노트를 만들 수 없어요.");
  const view = await waitForLiveView(created, LIVE_VIEW_WAIT_MS);
  if (!view) throw new Error("복구한 노트를 만들었지만 열리지 않았어요. 사본은 휴지통에 그대로 있어요.");
  useStore.getState().activateVirtualTab(null);
  replaceWholeDoc(view, text);
  return created;
}

export async function restoreCopyAsSibling(ref: CopyRef): Promise<string> {
  if (!isNoteExt(ref.relPath)) throw new Error("파일 관리자에서 이 파일의 사본으로 복구하세요.");
  const text = await ipc.readTrashCopy(ref.stamp, ref.relPath, epoch());
  return restoreTextAsSibling(originalPathOf(ref.relPath), text);
}

export async function deleteCopy(ref: CopyRef): Promise<void> {
  await ipc.deleteTrashCopy(ref.stamp, ref.relPath, epoch());
  // A tab showing a copy that no longer exists would only error on refresh.
  const s = useStore.getState();
  const src = copySource(ref);
  for (const t of s.virtualTabs) {
    if (t.kind === "text" && t.id === textTabId(src)) s.closeVirtualTab(t.id);
  }
}

/** Open (or focus) the single "Review changes" tab. */
export function openReviewTab(): void {
  useStore.getState().openVirtualTab({ kind: "review", id: REVIEW_TAB_ID, title: "변경 사항 검토" });
}
