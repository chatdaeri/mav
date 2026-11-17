/**
 * Plain-words summary of what sync did on reconnect (`sync/reconcileReport.ts`).
 *
 * Pure: the banner and Vault Health both render from these, and the tests pin
 * the wording. One line per kind, in a fixed order that puts the ones where the
 * user's own work moved somewhere first.
 */
import type { ReconcileItem, ReconcileKind } from "./sync/reconcileReport";
import { READ_ONLY_DETAIL } from "./sync/readOnlyRejections";
import { isNoteExt } from "./formats";
import { NOT_CREATOR_DETAIL } from "./sync/deletePolicy";

export const RECONCILE_KIND_ORDER: readonly ReconcileKind[] = [
  "deletedByTeammate",
  "keptLocally",
  "externalEditSaved",
  "conflictKeptServer",
  "selfRevoked",
  "restoredFromServer",
  "renamedConflict",
  "folderKept",
];

/** Short label for a kind, used in the Health list's first column. */
export const RECONCILE_KIND_LABEL: Record<ReconcileKind, string> = {
  deletedByTeammate: "팀원이 삭제함",
  keptLocally: "이 기기에 보관됨",
  selfRevoked: "내가 권한을 제거함",
  restoredFromServer: "복원됨",
  renamedConflict: "이름 변경됨",
  folderKept: "폴더 유지됨",
  externalEditSaved: "휴지통에 저장됨",
  conflictKeptServer: "팀원 버전 유지됨",
};

export interface ReconcileLine {
  kind: ReconcileKind;
  count: number;
  text: string;
}

function notes(n: number): string {
  return `노트 ${n.toLocaleString()}개`;
}

/** The last path segment, so a line names a file rather than a long path. */
function base(path: string): string {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** Collapse repeats of the same (kind, doc or path): a retry that records the
 *  same outcome twice must not double a count. Keeps the latest record. */
export function dedupeReconcileItems(items: readonly ReconcileItem[]): ReconcileItem[] {
  const byKey = new Map<string, ReconcileItem>();
  for (const it of items) {
    const key = `${it.kind}\u0000${it.docId ?? it.path}`;
    byKey.delete(key);
    byKey.set(key, it);
  }
  return [...byKey.values()];
}

/** `keptLocally` wording for NOTES only. Two causes share this kind: access
 *  removed (D7), and a read-only note whose edit the server refused. The
 *  wording must not claim lost access for the second — the user can still
 *  read the note. */
function keptNotesLine(group: ReconcileItem[]): string {
  const n = group.length;
  const ro = group.filter((it) => it.detail === READ_ONLY_DETAIL).length;
  if (ro === 0) {
    return `${notes(n)}는 이 기기에만 남아 있어요. 더 이상 접근 권한이 없어요.`;
  }
  if (ro === n) {
    return `${notes(n)}는 보기만 가능해서 내 수정이 반영되지 않았어요. 사본은 .context/trash에 있어요.`;
  }
  return `${notes(n)}는 이 기기에만 남아 있어요. 더 이상 접근 권한이 없거나 보기만 가능해요. 사본은 .context/trash에 있어요.`;
}

function lineFor(kind: ReconcileKind, group: ReconcileItem[]): string {
  const n = group.length;
  const one = n === 1;
  const items = group.every((it) => isNoteExt(it.path)) ? notes(n) : `파일 ${n.toLocaleString()}개`;
  switch (kind) {
    case "deletedByTeammate":
      return `오프라인에서 수정한 ${notes(n)}를 팀원이 삭제했어요. 내 버전은 휴지통에 있어요.`;
    case "restoredFromServer": {
      // A delete refused because a member may delete only what they created.
      const notMine = group.filter((it) => it.detail === NOT_CREATOR_DETAIL);
      if (notMine.length === n) {
        return one
          ? `${base(group[0].path)}을(를) 되돌려 놓았어요. 만든 사람이나 관리자만 삭제할 수 있어요.`
          : `${notes(n)}를 되돌려 놓았어요. 만든 사람이나 관리자만 삭제할 수 있어요.`;
      }
      // Binaries are restored too (#215); call them files when any are.
      const what = group.every((it) => isNoteExt(it.path))
        ? notes(n)
        : `파일 ${n.toLocaleString()}개`;
      // Not "while offline": a delete made online that never reached the server
      // (refused, or raced the note's registration) lands here too.
      return `삭제한 ${what}가 서버에 반영되지 않아 되돌려 놓았어요. 모두에게서 지우려면 다시 삭제하세요.`;
    }
    case "renamedConflict": {
      if (one) {
        const it = group[0];
        return `충돌을 피하려고 노트 1개의 이름을 바꿨어요: ${base(it.path)} → ${base(it.newPath ?? it.path)}`;
      }
      return `팀원의 노트와 충돌하지 않도록 ${notes(n)}의 이름을 바꿨어요.`;
    }
    case "keptLocally": {
      // A group can mix notes and binaries: describe each kind on its own, so a
      // read-only note's refused edit never inherits the binaries' "access was
      // removed" wording (or vice versa).
      const files = group.filter((it) => !isNoteExt(it.path)).length;
      const noteItems = group.filter((it) => isNoteExt(it.path));
      const parts: string[] = [];
      if (noteItems.length > 0) parts.push(keptNotesLine(noteItems));
      if (files > 0) {
        parts.push(
          `접근 권한이 제거되어 파일 ${files.toLocaleString()}개를 .context/trash로 옮겼어요. 복구용 사본은 활동에서 찾을 수 있어요.`,
        );
      }
      return parts.join(" ");
    }
    case "selfRevoked":
      return `${items}에 대한 내 접근 권한을 직접 제거했어요. 사본은 이 기기에 남아 있어요.`;
    case "externalEditSaved":
      return `오프라인 중 다른 앱에서 바뀐 ${notes(n)}를 병합하지 못했어요. 내 버전은 .context/trash에 저장했어요.`;
    case "conflictKeptServer":
      return one
        ? `${base(group[0].path)}: 팀원의 버전을 유지했어요. 내 텍스트는 복구용으로 저장했어요.`
        : `${notes(n)}: 팀원의 버전을 유지했어요. 내 텍스트는 복구용으로 저장했어요.`;
    case "folderKept":
      return one
        ? `폴더 ${base(group[0].path)}에 노트를 추가해서 폴더를 유지했어요.`
        : `노트를 추가한 폴더 ${n.toLocaleString()}개를 유지했어요.`;
  }
}

/** One line per kind present, in {@link RECONCILE_KIND_ORDER}. */
export function summarizeReconcile(items: readonly ReconcileItem[]): ReconcileLine[] {
  const groups = new Map<ReconcileKind, ReconcileItem[]>();
  for (const it of dedupeReconcileItems(items)) {
    const g = groups.get(it.kind);
    if (g) g.push(it);
    else groups.set(it.kind, [it]);
  }
  const out: ReconcileLine[] = [];
  for (const kind of RECONCILE_KIND_ORDER) {
    const g = groups.get(kind);
    if (g && g.length > 0) out.push({ kind, count: g.length, text: lineFor(kind, g) });
  }
  return out;
}
