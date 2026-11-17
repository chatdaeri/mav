/* The right panel's Activity feed: ONE chronological list merged from three
   sources, newest first.
   - reconcile items (this session's reconnect report, deduped),
   - server-Trash notes (a synced vault's soft-deleted notes),
   - local recovery copies in .context/trash NOT already named by a reconcile
     row (those carry their copy's actions on the reconcile row itself),
   - a held bulk delete (the #221 notice, with the same Restore now),
   - server `pre-shrink` captures (a note that lost most of its text),
   - sync pauses the shrink burst brake put on a member (#252),
   - this session's access changes,
   - the sync failures Health lists under Needs attention,
   - invitations that expired unaccepted (#268; the server records each once).
   Pure, so the merge and the de-duplication are tested without a DOM. */
import type { InvitationExpiry, ShrinkBrakeEvent, ShrinkEvent, TrashItem } from "../lib/api";
import type { HealthFailures } from "../lib/health/model";
import type { AccessEvent } from "../store";
import type { TrashCopy } from "../lib/ipc";
import type { ReconcileItem } from "../lib/sync/reconcileReport";
import { RECONCILE_KIND_LABEL, dedupeReconcileItems } from "../lib/reconcileSummary";
import { reconcileCopyRef, stampTime } from "./recoveryCopies";

export type ActivityRow =
  | { type: "reconcile"; key: string; at: number; label: string; path: string; item: ReconcileItem }
  | { type: "trash"; key: string; at: number; label: string; path: string; item: TrashItem }
  | { type: "copy"; key: string; at: number; label: string; path: string; copy: TrashCopy }
  | { type: "held"; key: string; at: number; label: string; path: string; count: number; text: string }
  | { type: "shrunk"; key: string; at: number; label: string; path: string; event: ShrinkEvent; text: string }
  | {
      type: "paused";
      key: string;
      at: number;
      label: string;
      path: string;
      event: ShrinkBrakeEvent;
      text: string;
      /** The viewer is an owner/admin and the pause is still live. */
      canRelease: boolean;
      /** The pause is the viewer's own. */
      own: boolean;
    }
  | { type: "access"; key: string; at: number; label: string; path: string; event: AccessEvent; text: string }
  | { type: "failed"; key: string; at: number; label: string; path: string; failure: FailedEntry; text: string }
  | { type: "invitation"; key: string; at: number; label: string; path: string; invitation: InvitationExpiry; text: string };

/** One Needs-attention failure, flattened from `syncManager.syncFailures()`. */
export interface FailedEntry {
  key: string;
  docId: string | null;
  path: string;
  reason: string;
  /** `syncManager.retryDoc` can help: a doc id, and not a permanent refusal. */
  retryable: boolean;
}

/** Flatten the failures Health's Needs attention is built from. The held
 *  bulk delete's per-note entries are left out: the Held row asks that. So
 *  are notes a sync pause is holding: the Paused row says that (#252). */
export function failureEntries(f: HealthFailures | null | undefined): FailedEntry[] {
  if (!f) return [];
  const out: FailedEntry[] = [];
  for (const c of f.content) {
    if (c.kind === "shrink-held") continue;
    out.push({
      key: `fc:${c.docId}`,
      docId: c.docId,
      path: c.relPath,
      reason: c.reason,
      retryable: !c.permanent,
    });
  }
  for (const r of f.registry) {
    if (r.kind === "inbound-blocked" && r.code === "delete_decision") continue;
    // Vault-wide, with no path to name: the Health issue says it.
    if (r.kind === "pull") continue;
    out.push({
      key: `fr:${r.kind}:${r.docId ?? r.path}`,
      docId: r.docId,
      path: r.path,
      reason: r.reason,
      retryable: r.docId != null,
    });
  }
  return out;
}

/** Logged Failed rows to drop: sync no longer reports them and their note is
 *  confirmed on the server, so the row would contradict the synced badge. */
export function staleFailureIds(
  log: readonly { id: string; kind: string; docId?: string }[],
  liveKeys: ReadonlySet<string>,
  isPushed: (docId: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const e of log) {
    if (e.kind !== "failed" || liveKeys.has(e.id) || !e.docId) continue;
    if (isPushed(e.docId)) out.push(e.id);
  }
  return out;
}

/** Retry on a doc that already synced has nothing to send: clear the row. */
export function retryAction(docId: string, settled: (docId: string) => boolean): "clear" | "retry" {
  return settled(docId) ? "clear" : "retry";
}

const n = (x: number) => x.toLocaleString("en-US");

export function shrinkText(e: Pick<ShrinkEvent, "beforeChars" | "afterChars">): string {
  return `${n(e.beforeChars)}자에서 ${n(e.afterChars)}자로 줄었어요`;
}

export function heldText(count: number): string {
  return `노트 ${n(count)}개가 한꺼번에 디스크에서 사라졌어요`;
}

export function invitationExpiredText(e: Pick<InvitationExpiry, "email">): string {
  return `${e.email}님에 대한 초대가 수락되기 전에 만료됐어요`;
}

/** "Sync paused for Sam · 12 notes emptied at once" ("Your sync was paused"
 *  when it is the viewer's own). */
export function pausedText(e: Pick<ShrinkBrakeEvent, "userName" | "noteCount">, own: boolean): string {
  const notes = `노트 ${n(e.noteCount)}개가 한꺼번에 비워짐`;
  if (own) return `내 동기화가 일시 중지됨 · ${notes}`;
  const who = e.userName?.trim() ? `${e.userName.trim()}님` : "한 멤버";
  return `${who}의 동기화가 일시 중지됨 · ${notes}`;
}

export function accessText(e: AccessEvent): string {
  if (e.kind === "removed") return e.self ? "내가 권한을 제거했어요" : "이 노트에 대한 권한이 제거됐어요";
  return `노트 ${n(e.count)}개를 이제 볼 수 있어요`;
}

/** Row tooltips: the short explanations the old section descriptions gave. */
export const ACTIVITY_HINT = {
  reconcile: "오프라인이던 동안 마이 세컨드 브레인을 켠 이후 동기화가 나를 위해 바꾼 내용이에요.",
  trash: "서버에서 삭제됐어요. 영구 삭제되기 전까지 휴지통에 남아 있고, 복원하면 모든 멤버에게 다시 보여요.",
  copy: ".context/trash에 있는 로컬 복구 사본이에요. 동기화되지 않아요.",
  held: "많은 노트가 볼트 폴더에서 한꺼번에 사라졌어요. 팀에서는 아무것도 삭제되지 않았고, 여기서 복원하는 중이에요.",
  shrunk: "편집 후 이 노트에 원래의 5분의 1 이하만 남았어요. 서버에는 그 이전 텍스트가 보관돼 있어요.",
  paused:
    "한 계정에서 많은 노트가 한꺼번에 비워져서 서버가 그 계정의 동기화를 일시 중지했어요. " +
    "비워진 노트는 먼저 모두 버전으로 저장됐어요. 해당 편집은 상대방 기기에 남아 있다가 " +
    "일시 중지가 끝나거나 소유자 또는 관리자가 해제하면 동기화돼요.",
  access: "누군가 이 항목을 볼 수 있는 사람을 바꿨어요. 이번 앱 실행 중의 변경만 표시돼요.",
  failed: "이 항목의 동기화를 끝내지 못했어요.",
  invitation: "만료되기 전에 아무도 이 초대를 수락하지 않았어요. 다시 보내면 만료 기한이 새로운 링크를 보내요.",
} as const;

const copyId = (stamp: string, relPath: string) => `${stamp}/${relPath}`;

export function buildActivity(input: {
  reconcile: readonly ReconcileItem[];
  trash: readonly TrashItem[];
  copies: readonly TrashCopy[];
  /** The held bulk delete, stamped with when this feed first saw it. */
  held?: { count: number; at: number } | null;
  shrinks?: readonly ShrinkEvent[];
  /** Sync pauses (shrink brake holds) and whether the viewer may release them. */
  brakes?: { items: readonly ShrinkBrakeEvent[]; canRelease: boolean; selfId: string | null } | null;
  access?: readonly AccessEvent[];
  /** Failures, each stamped with when this feed first saw it. */
  failures?: readonly (FailedEntry & { at: number })[];
  invitations?: readonly InvitationExpiry[];
}): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const claimed = new Set<string>();
  for (const it of dedupeReconcileItems(input.reconcile)) {
    const ref = reconcileCopyRef(it);
    if (ref) claimed.add(copyId(ref.stamp, ref.relPath));
    rows.push({
      type: "reconcile",
      key: `r:${it.kind}:${it.docId ?? it.path}`,
      at: it.at,
      label: RECONCILE_KIND_LABEL[it.kind],
      path: it.path,
      item: it,
    });
  }
  for (const t of input.trash) {
    const at = Date.parse(t.deletedAt);
    rows.push({
      type: "trash",
      key: `t:${t.docId}`,
      at: Number.isFinite(at) ? at : 0,
      label: "삭제됨",
      path: t.relPath,
      item: t,
    });
  }
  for (const c of input.copies) {
    if (claimed.has(copyId(c.stamp, c.relPath))) continue;
    rows.push({
      type: "copy",
      key: `c:${copyId(c.stamp, c.relPath)}`,
      at: stampTime(c.stamp) ?? c.modified,
      label: "사본",
      path: c.relPath,
      copy: c,
    });
  }
  if (input.held && input.held.count > 0) {
    rows.push({
      type: "held",
      key: "h:bulk-delete",
      at: input.held.at,
      label: "보류됨",
      path: "",
      count: input.held.count,
      text: heldText(input.held.count),
    });
  }
  for (const e of input.shrinks ?? []) {
    const at = Date.parse(e.capturedAt);
    rows.push({
      type: "shrunk",
      key: `s:${e.versionId}`,
      at: Number.isFinite(at) ? at : 0,
      label: "줄어듦",
      path: e.relPath,
      event: e,
      text: shrinkText(e),
    });
  }
  for (const e of input.brakes?.items ?? []) {
    const at = Date.parse(e.engagedAt);
    const own = input.brakes?.selfId != null && e.userId === input.brakes.selfId;
    rows.push({
      type: "paused",
      key: `p:${e.id}`,
      at: Number.isFinite(at) ? at : 0,
      label: e.held ? "일시 중지됨" : "재개됨",
      path: "",
      event: e,
      text: pausedText(e, own),
      canRelease: input.brakes?.canRelease === true && e.held,
      own,
    });
  }
  (input.access ?? []).forEach((e) => {
    rows.push({
      type: "access",
      key: e.kind === "removed" ? `a:r:${e.docId}:${e.at}` : `a:g:${e.at}`,
      at: e.at,
      label: "권한",
      path: e.kind === "removed" ? e.path : "",
      event: e,
      text: accessText(e),
    });
  });
  for (const f of input.failures ?? []) {
    rows.push({
      type: "failed",
      key: f.key,
      at: f.at,
      label: "실패",
      path: f.path,
      failure: f,
      text: f.reason,
    });
  }
  for (const inv of input.invitations ?? []) {
    const at = Date.parse(inv.expiredAt);
    rows.push({
      type: "invitation",
      key: `i:${inv.invitationId}`,
      at: Number.isFinite(at) ? at : 0,
      label: "만료됨",
      path: "",
      invitation: inv,
      text: invitationExpiredText(inv),
    });
  }
  // Newest first; ties by key so the order is stable across refreshes.
  rows.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  return rows;
}
