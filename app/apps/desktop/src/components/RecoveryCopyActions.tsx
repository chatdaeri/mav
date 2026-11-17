/* Row actions for one local recovery copy, shared by Vault Health's
   "Reconciled on reconnect" rows and its "Recovery copies" list: Open copy,
   a Restore menu (replace the current note, or a sibling), Delete
   copy. After a restore it offers to delete the copy. */
import { useEffect, useState } from "react";
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { noteLabel } from "../lib/notePath";
import { isNoteExt } from "../lib/formats";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { RowActionsMenu, type RowAction } from "./RowActionsMenu";
import { copyActions, originalPathOf, siblingRecoveredPath, type CopyRef } from "./recoveryCopies";
import {
  deleteCopy,
  openCopy,
  restoreCopyAsSibling,
  restoreCopyReplace,
} from "./recoveryActions";

/** Does a note exist at `path` right now? null while unknown. */
export function useNoteExists(path: string | null, nonce = 0): boolean | null {
  const epoch = useStore((s) => s.vault?.epoch);
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    if (!path) {
      setExists(false);
      return;
    }
    let cancelled = false;
    ipc.noteExists(path, epoch).then(
      (v) => !cancelled && setExists(v),
      () => !cancelled && setExists(false),
    );
    return () => {
      cancelled = true;
    };
  }, [path, epoch, nonce]);
  return exists;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function RecoveryCopyActions({
  copy,
  notePath,
  modified,
  onChanged,
}: {
  copy: CopyRef;
  /** The live note this copy belongs to; defaults to the copy's original path. */
  notePath?: string;
  modified?: number;
  /** After a delete or restore, so the parent list can refresh. */
  onChanged?: () => void;
}) {
  const target = notePath ?? originalPathOf(copy.relPath);
  const [nonce, setNonce] = useState(0);
  const exists = useNoteExists(target, nonce);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "afterRestore">(null);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);
  // A read-only note refuses the edit itself (liveEditorViews), with its own
  // message, so write access is not second-guessed here.
  const binary = !isNoteExt(copy.relPath);
  const avail = copyActions({ hasCopy: true, liveNoteExists: exists === true, canWrite: !binary });

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
      throw e;
    }
  };

  const restoreActions: RowAction[] = [];
  if (avail.restoreReplace) {
    restoreActions.push({
      key: "replace",
      label: "현재 노트 바꾸기",
      title: `이 사본의 텍스트를 ${noteLabel(target)}에 넣어요. 편집한 것처럼 동기화돼요.`,
      onSelect: () =>
        run(async () => {
          await restoreCopyReplace(copy, target);
          setRestoredTo(target);
          setConfirm("afterRestore");
        }).catch(() => {}),
    });
  }
  if (avail.restoreSibling) {
    const sibling = siblingRecoveredPath(target, () => false);
    restoreActions.push({
      key: "sibling",
      label: `“${noteLabel(sibling)}”(으)로 복원`,
      title: "이 사본의 텍스트로 원본 옆에 새 노트를 만들어요.",
      onSelect: () =>
        run(async () => {
          const created = await restoreCopyAsSibling(copy);
          setRestoredTo(created);
          setConfirm("afterRestore");
          setNonce((n) => n + 1);
        }).catch(() => {}),
    });
  }
  restoreActions.push({
    key: "delete",
    label: "사본 삭제",
    danger: true,
    separated: true,
    onSelect: () => setConfirm("delete"),
  });

  const doDelete = () =>
    run(async () => {
      await deleteCopy(copy);
      setConfirm(null);
      onChanged?.();
    });

  return (
    <>
      <span className="health-missing-actions">
        <button type="button" className="ghost-pill sm" onClick={() => openCopy(copy, modified)}>
          {binary ? ipc.revealLabel() : "사본 열기"}
        </button>
        <RowActionsMenu actions={restoreActions} ariaLabel={binary ? "복구 사본 작업" : "이 사본 복원 또는 삭제"} />
      </span>
      {error && (
        <p role="alert" className="auth-error health-missing-error">
          {error}
        </p>
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="이 사본을 삭제할까요?"
          confirmLabel="사본 삭제"
          tone="danger"
          onConfirm={doDelete}
          onCancel={() => setConfirm(null)}
        >
          .context/trash에 있는 사본이 이 기기에서 삭제돼요. 현재 파일은 바뀌지
          않아요.
        </ConfirmDialog>
      )}
      {confirm === "afterRestore" && (
        <ConfirmDialog
          title="복원했어요. 사본을 삭제할까요?"
          confirmLabel="사본 삭제"
          cancelLabel="사본 유지"
          onConfirm={doDelete}
          onCancel={() => {
            setConfirm(null);
            onChanged?.();
          }}
        >
          {`사본의 텍스트가 이제 ${restoredTo ? noteLabel(restoredTo) : "노트"}에 들어 있어요. 사본을 삭제하거나 .context/trash에 그대로 둘 수 있어요.`}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Preview for one server Trash row. */
export function TrashPreviewActions({
  docId,
  relPath,
  onPreview,
}: {
  docId: string;
  relPath: string;
  onPreview: (docId: string, relPath: string) => void;
}) {
  return (
    <AsyncButton className="ghost-pill sm" onClick={() => onPreview(docId, relPath)}>
      미리보기
    </AsyncButton>
  );
}
