/* The right panel's Activity tab (RightPanel.tsx): ONE chronological feed of
   what happened to this vault's notes, merged by `activityRows.ts`. This file
   only renders; the data, fetch schedule, notice log and unread state live in
   `activitySource.tsx`, mounted once so the toolbar badge works while closed.

   The server Trash keeps its old rules: only a connected vault is current;
   offline or signed out it shows the last listing it fetched (per vault id,
   this app session) and Restore waits for the connection. */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { authManager } from "../lib/auth/authManager";
import type { InvitationExpiry, ShrinkBrakeEvent, ShrinkEvent, TrashItem } from "../lib/api";
import { buildInviteLink } from "../lib/inviteLink";
import { toast } from "../lib/toast";
import { syncManager } from "../lib/sync/docSession";
import type { ReconcileItem } from "../lib/sync/reconcileReport";
import { splitPath } from "../lib/health/format";
import { AsyncButton } from "./AsyncButton";
import { RecoveryCopyActions, TrashPreviewActions, useNoteExists } from "./RecoveryCopyActions";
import { reconcileCopyRef } from "./recoveryCopies";
import { openReviewTab, openTrashPreview } from "./recoveryActions";
import { usePendingReviewCount } from "./ReviewTab";
import { type ActivityRow, type FailedEntry, retryAction } from "./activityRows";
import { activityRowText } from "./activityRowText";
import { ConfirmDialog } from "./ConfirmDialog";
import { trashErrorMessage, useActivitySnapshot } from "./activitySource";
import { noteLabel } from "../lib/notePath";

/** Rows shown before "Show more", like the Health lists. */
const PAGE = 20;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function ReconcileRowActions({ item, onChanged }: { item: ReconcileItem; onChanged: () => void }) {
  const copy = reconcileCopyRef(item);
  if (copy) return <RecoveryCopyActions copy={copy} notePath={item.path} onChanged={onChanged} />;
  if (item.kind === "restoredFromServer") {
    return (
      <span className="health-missing-actions">
        <button
          type="button"
          className="ghost-pill sm"
          onClick={() => void useStore.getState().openNoteByPath(item.path)}
        >
          노트 열기
        </button>
      </span>
    );
  }
  return null;
}

function TrashRowActions({
  item,
  online,
  onRestored,
}: {
  item: TrashItem;
  online: boolean;
  onRestored: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    setError(null);
    try {
      await authManager.api.restoreNote(item.docId);
    } catch (e) {
      setError(trashErrorMessage(e));
      return;
    }
    onRestored();
  };
  return (
    <>
      <span className="health-missing-actions">
        {online && (
          <TrashPreviewActions
            docId={item.docId}
            relPath={item.relPath}
            onPreview={openTrashPreview}
          />
        )}
        <AsyncButton
          className="ghost-pill sm"
          disabled={!online}
          title={online ? "모든 멤버에게 다시 보이게 해요." : "복원하려면 다시 연결하세요."}
          onClick={restore}
        >
          복원
        </AsyncButton>
      </span>
      {error && (
        <p role="alert" className="auth-error health-missing-error">
          {error}
        </p>
      )}
    </>
  );
}

function HeldRowActions({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  // Exactly the notice's handler (components/NoticeSlot.tsx): over the cap a
  // disk delete is never sent to the team, so the only answer is to restore.
  const restore = () => {
    setBusy(true);
    void useStore
      .getState()
      .releaseBulkDelete("restore")
      .catch((e) => console.warn("[sync] bulk delete restore failed", e))
      .finally(() => {
        setBusy(false);
        onDone();
      });
  };
  return (
    <span className="health-missing-actions">
      <button type="button" className="ghost-pill sm" disabled={busy} onClick={restore}>
        지금 복원
      </button>
    </span>
  );
}

function ShrunkRowActions({
  event,
  online,
  onDone,
}: {
  event: ShrinkEvent;
  online: boolean;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const restore = async () => {
    setConfirm(false);
    try {
      await authManager.api.revertNoteToVersion(event.docId, event.versionId);
      toast(`${noteLabel(event.relPath)}을(를) 줄어들기 전 텍스트로 복원했어요.`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
    onDone();
  };
  if (event.deleted) return null;
  return (
    <>
      <span className="health-missing-actions">
        <button
          type="button"
          className="ghost-pill sm"
          disabled={!online}
          title={online ? "이전 텍스트를 모든 멤버에게 되돌려요." : "복원하려면 다시 연결하세요."}
          onClick={() => setConfirm(true)}
        >
          버전 복원
        </button>
      </span>
      {confirm && (
        <ConfirmDialog
          title="이 버전으로 복원할까요?"
          confirmLabel="버전 복원"
          onConfirm={restore}
          onCancel={() => setConfirm(false)}
        >
          노트가 줄어들기 전 텍스트로 모든 멤버에게 되돌아가요. 현재 텍스트는 버전으로
          남아 있어서 버전 기록에서 되돌릴 수 있어요.
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Release a member's sync pause early (owner/admin, #252). Their held edits
 * then arrive like any edit — each sharp shrink is still saved as a version
 * first, and a renewed burst pauses them again.
 */
function PausedRowActions({
  event,
  online,
  onDone,
}: {
  event: ShrinkBrakeEvent;
  online: boolean;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const who = event.userName?.trim() || "이 멤버";
  const release = async () => {
    setConfirm(false);
    const vaultId = syncManager.registry.vaultId;
    if (!vaultId) return;
    try {
      await authManager.api.releaseShrinkBrake(vaultId, event.userId);
      toast(`${who}님의 동기화를 재개했어요.`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
    onDone();
  };
  return (
    <>
      <span className="health-missing-actions">
        <button
          type="button"
          className="ghost-pill sm"
          disabled={!online}
          title={online ? "보류된 편집을 지금 동기화해요." : "해제하려면 다시 연결하세요."}
          onClick={() => setConfirm(true)}
        >
          해제
        </button>
      </span>
      {confirm && (
        <ConfirmDialog
          title={`${who}님의 동기화를 재개할까요?`}
          confirmLabel="해제"
          onConfirm={release}
          onCancel={() => setConfirm(false)}
        >
          상대방 기기에서 대기 중이던 편집이 지금 동기화돼요. 비운 노트도 포함돼요.
          비워진 노트는 먼저 모두 버전으로 저장되어 있어서 버전 기록에서 복원할 수 있어요.
          실수였을 수 있다면 여기서 '줄어듦' 행을 먼저 확인하세요.
        </ConfirmDialog>
      )}
    </>
  );
}

function OpenNoteButton({ path }: { path: string }) {
  return (
    <button
      type="button"
      className="ghost-pill sm"
      onClick={() => void useStore.getState().openNoteByPath(path)}
    >
      노트 열기
    </button>
  );
}

function GrantRowActions({ paths }: { paths: readonly string[] }) {
  const first = paths[0] ?? null;
  const readable = useNoteExists(first) === true;
  if (!first || !readable) return null;
  return (
    <span className="health-missing-actions">
      <OpenNoteButton path={first} />
    </span>
  );
}

function FailedRowActions({
  failure,
  onDone,
  onDismiss,
}: {
  failure: FailedEntry;
  onDone: () => void;
  onDismiss: (key: string) => void;
}) {
  const exists = useNoteExists(failure.path || null) === true;
  if (!exists && !failure.retryable) return null;
  return (
    <span className="health-missing-actions">
      {exists && <OpenNoteButton path={failure.path} />}
      {failure.retryable && failure.docId && (
        // Health's retry handler (useVaultHealth `retryDoc`).
        <AsyncButton
          className="ghost-pill sm"
          onClick={async () => {
            const docId = failure.docId as string;
            // Already synced: nothing to send, the row was simply stale.
            if (retryAction(docId, (id) => syncManager.failureSettled(id)) === "clear") {
              onDismiss(failure.key);
            } else {
              await syncManager.retryDoc(docId);
            }
            onDone();
          }}
        >
          다시 시도
        </AsyncButton>
      )}
    </span>
  );
}

/**
 * Resend an expired invitation: the Members tab's Resend (VaultSettingsDialog),
 * aimed at the notice's own vault. Better Auth gives the address a fresh row
 * (new link, new expiry), which is also what drops this notice server-side.
 * Without email the new link goes to the clipboard instead.
 */
function InvitationRowActions({
  invitation,
  online,
  onDone,
}: {
  invitation: InvitationExpiry;
  online: boolean;
  onDone: () => void;
}) {
  const resend = async () => {
    try {
      const role = invitation.role === "admin" ? "admin" : "member";
      const r = await useStore.getState().inviteMember(invitation.email, role, invitation.organizationId);
      if (r.emailed) {
        toast(`${invitation.email}님에게 새 초대를 보냈어요.`, "success");
      } else {
        const link = buildInviteLink(useStore.getState().serverUrl, r.invitation.id);
        let copied = false;
        if (link) {
          try {
            await navigator.clipboard.writeText(link);
            copied = true;
          } catch {
            /* clipboard unavailable */
          }
        }
        const how = copied ? "링크를 복사했어요. 상대방에게 공유하세요." : "볼트 설정 → 멤버 및 권한에서 링크를 공유하세요.";
        toast(
          r.emailError ? `새 초대를 만들었지만 이메일 전송에 실패했어요: ${r.emailError} ${how}` : `새 초대를 만들었어요. ${how}`,
          r.emailError ? "error" : "success",
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
    onDone();
  };
  return (
    <span className="health-missing-actions">
      <AsyncButton
        className="ghost-pill sm"
        disabled={!online}
        title={online ? "새 링크로 초대를 다시 보내요." : "다시 보내려면 다시 연결하세요."}
        onClick={resend}
      >
        다시 보내기
      </AsyncButton>
    </span>
  );
}

/** A path on one line: the folder part ellipsizes first, so the filename
 *  stays whole at any panel width (the CSS form of `middleTruncate`). */
function RowPath({ path }: { path: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span className="activity-row-path" title={path}>
      {dir && <span className="activity-row-dir">{dir}</span>}
      <span className="activity-row-file">{name}</span>
    </span>
  );
}

function rowTone(row: ActivityRow): "warn" | undefined {
  return (row.type === "trash" && row.item.hasUnsyncedContributions) ||
    row.type === "held" ||
    (row.type === "paused" && row.event.held) ||
    row.type === "shrunk" ||
    row.type === "failed" ||
    row.type === "invitation"
    ? "warn"
    : undefined;
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** The empty state's muted glyph: the same activity-log mark as the tab. */
function ActivityLogIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="5" cy="18" r="1.4" />
      <path d="M10 6h10M10 12h10M10 18h7" />
    </svg>
  );
}

export function ActivityFeed() {
  const now = useNow();
  const [limit, setLimit] = useState(PAGE);
  const snap = useActivitySnapshot();
  const { rows, schedule, updating, activeFailures, dismissFailure } = snap;
  const pending = usePendingReviewCount();
  const trash = { online: snap.trashOnline };
  const [confirmClear, setConfirmClear] = useState(false);
  // One row open at a time; a second click (or Enter/Space) closes it.
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Opening the panel on Activity refreshes (the host also schedules on the
  // tab switch; the debounce makes the two one fetch).
  useEffect(() => {
    schedule();
  }, [schedule]);

  const showToolbar = pending > 0 || updating || rows.length > 0;
  return (
    <div className="activity-feed">
      {showToolbar && (
        <div className="activity-toolbar">
          {pending > 0 && (
            <button type="button" className="primary sm" onClick={openReviewTab}>
              {`변경 사항 검토 (${pending.toLocaleString()})`}
            </button>
          )}
          {updating && (
            <span className="activity-updating muted" role="status">
              업데이트 중…
            </span>
          )}
          {rows.length > 0 && (
            <button
              type="button"
              className="activity-clear"
              onClick={() => setConfirmClear(true)}
            >
              지우기
            </button>
          )}
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="활동을 지울까요?"
          confirmLabel="지우기"
          tone="accent"
          onConfirm={() => {
            snap.clear();
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        >
          여기 나열된 항목은 이 기기에서 숨겨지고, 검토 대기 중인 변경 사항은 건너뜀으로
          표시돼요. 노트, 파일, 복구 사본은 삭제되지 않으며 새 항목은 계속 표시돼요.
        </ConfirmDialog>
      )}
      {!snap.trashOnline && snap.trashCached && (
        <p className="muted activity-note">삭제된 노트는 마지막으로 확인한 목록이에요. 복원하려면 다시 연결하세요.</p>
      )}
      {snap.error && (
        <p role="alert" className="auth-error health-missing-error">
          {snap.error}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="activity-empty">
          <span className="activity-empty-icon">
            <ActivityLogIcon />
          </span>
          <p className="activity-empty-title">아직 활동이 없어요.</p>
          <p className="muted activity-empty-hint">
            동기화가 나를 위해 한 변경, 삭제된 노트, 복구 사본이 여기에 표시돼요.
          </p>
        </div>
      ) : (
        <>
          <ul className="activity-list">
            {rows.slice(0, limit).map((row, i) => {
              const t = activityRowText(row, now);
              const open = openKey === row.key;
              const detailId = `activity-row-detail-${i}`;
              const toggle = () => setOpenKey(open ? null : row.key);
              return (
                <li key={row.key} className="activity-row" data-open={open || undefined}>
                  <div
                    className="activity-row-head"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-controls={detailId}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                  >
                    <span className="health-pill activity-row-chip" data-tone={rowTone(row)} data-kind={row.type}>
                      {t.label}
                    </span>
                    <span className="activity-row-body">
                      <span className="activity-row-line">
                        <span className="activity-row-message">{t.message}</span>
                        <span className="activity-row-time muted">{t.when}</span>
                        <span className="activity-row-chevron muted">
                          <ChevronIcon />
                        </span>
                      </span>
                      {t.path && !open && <RowPath path={t.path} />}
                    </span>
                  </div>
                  {open && (
                    <div id={detailId} className="activity-row-detail">
                      {t.bodyPaths.length > 0 && (
                        <ul className="activity-row-paths">
                          {t.bodyPaths.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                          {t.morePaths > 0 && (
                            <li className="muted">{`and ${t.morePaths.toLocaleString()} more`}</li>
                          )}
                        </ul>
                      )}
                      <p className="activity-row-explain">{t.detail}</p>
                      {t.facts.map((f) => (
                        <p key={f} className="activity-row-fact muted">
                          {f}
                        </p>
                      ))}
                      <p className="activity-row-fact muted">{t.absoluteTime}</p>
                      <div className="activity-row-actions">
                        {row.type === "reconcile" ? (
                          <ReconcileRowActions item={row.item} onChanged={schedule} />
                        ) : row.type === "held" ? (
                          <HeldRowActions onDone={schedule} />
                        ) : row.type === "paused" ? (
                          row.canRelease ? (
                            <PausedRowActions event={row.event} online={trash.online} onDone={schedule} />
                          ) : null
                        ) : row.type === "shrunk" ? (
                          <ShrunkRowActions event={row.event} online={trash.online} onDone={schedule} />
                        ) : row.type === "failed" ? (
                          activeFailures.has(row.key) ? <FailedRowActions failure={row.failure} onDone={schedule} onDismiss={dismissFailure} /> : null
                        ) : row.type === "access" ? (
                          row.event.kind === "granted" ? <GrantRowActions paths={row.event.paths ?? []} /> : null
                        ) : row.type === "invitation" ? (
                          <InvitationRowActions invitation={row.invitation} online={trash.online} onDone={schedule} />
                        ) : row.type === "trash" ? (
                          <TrashRowActions item={row.item} online={trash.online} onRestored={schedule} />
                        ) : (
                          <RecoveryCopyActions
                            copy={{ stamp: row.copy.stamp, relPath: row.copy.relPath }}
                            modified={row.copy.modified}
                            onChanged={schedule}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length > limit && (
            <button type="button" className="link-btn activity-more" onClick={() => setLimit(limit + PAGE)}>
              {`더 보기 (${(rows.length - limit).toLocaleString()}개 남음)`}
            </button>
          )}
          {snap.trashTruncated && (
            <p className="muted activity-note">최근에 삭제된 노트만 표시돼요.</p>
          )}
        </>
      )}
    </div>
  );
}
