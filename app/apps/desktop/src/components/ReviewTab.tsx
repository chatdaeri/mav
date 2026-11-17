/* "Review changes": one editor-area tab that walks every reconnect item with
   something to compare. The main area shows the compare for the selected item;
   the list on the right shows every item with its kind, path, size of the
   difference and pending/resolved state. Resolved state is per app session
   (`reviewModel.ts reviewState`), which is also what the banner counts. */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { noteLabel } from "../lib/notePath";
import { reconcileReport, type ReconcileItem } from "../lib/sync/reconcileReport";
import { RECONCILE_KIND_LABEL } from "../lib/reconcileSummary";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { CompareBody, ReadOnlyText } from "./CompareTab";
import { PathText } from "./HealthShared";
import { useNoteExists } from "./RecoveryCopyActions";
import { copyTabTitle, stampTime } from "./recoveryCopies";
import {
  deleteCopy,
  openCopy,
  openReviewTab,
  restoreCopyAsSibling,
  restoreCopyReplace,
} from "./recoveryActions";
import { loadSource } from "./textSources";
import { formatLineChanges, lineChanges, type LineChanges } from "./lineChanges";
import {
  nextPendingKey,
  pendingItems,
  planResolveAll,
  reviewItems,
  reviewState,
  type Resolution,
  type ResolvedMap,
  type ReviewItem,
} from "./reviewModel";
import type { TextSource } from "./virtualTabs";

/** Line counts are computed for at most this many rows up front. */
const COUNT_LIMIT = 200;

const RESOLUTION_LABEL: Record<Resolution, string> = {
  kept: "현재 버전 유지",
  restored: "사본 복원됨",
  restoredSibling: "새 노트로 복원됨",
  skipped: "건너뜀",
};

export function useReviewState(): ResolvedMap {
  const [m, setM] = useState<ResolvedMap>(() => reviewState.get());
  useEffect(() => reviewState.subscribe(setM), []);
  return m;
}

function useReportItems(): ReconcileItem[] {
  const [items, setItems] = useState<ReconcileItem[]>(() => reconcileReport.items());
  useEffect(() => reconcileReport.subscribe(setItems), []);
  return items;
}

function sidesOf(it: ReviewItem): { left: TextSource; right: TextSource } | null {
  if (it.copy) return { left: { type: "copy", ...it.copy }, right: { type: "note", path: it.path } };
  if (it.otherPath) return { left: { type: "note", path: it.path }, right: { type: "note", path: it.otherPath } };
  return null;
}

function useLineCounts(items: readonly ReviewItem[], nonce: number): Record<string, LineChanges> {
  const epoch = useStore((s) => s.vault?.epoch);
  const [counts, setCounts] = useState<Record<string, LineChanges>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items.slice(0, COUNT_LIMIT)) {
        const sides = sidesOf(it);
        if (!sides) continue;
        try {
          const [a, b] = await Promise.all([loadSource(sides.left, epoch), loadSource(sides.right, epoch)]);
          if (cancelled) return;
          setCounts((c) => ({ ...c, [it.key]: lineChanges(a, b) }));
        } catch {
          // A side that cannot load (the note was deleted) has no count.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, epoch, nonce]);
  return counts;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ItemView({
  item,
  resolution,
  onResolved,
}: {
  item: ReviewItem;
  resolution: Resolution | undefined;
  onResolved: (how: Resolution) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const noteExists = useNoteExists(item.path, nonce);
  const run = async (fn: () => Promise<Resolution>) => {
    setError(null);
    try {
      onResolved(await fn());
      setNonce((n) => n + 1);
    } catch (e) {
      setError(errText(e));
    }
  };
  const at = item.copy ? stampTime(item.copy.stamp) ?? item.at : item.at;

  let body;
  if (item.copy && noteExists) {
    body = (
      <CompareBody
        key={item.key}
        left={{ label: copyTabTitle(item.copy.relPath, at), source: { type: "copy", ...item.copy } }}
        right={{ label: `현재: ${noteLabel(item.path)}`, source: { type: "note", path: item.path } }}
        nonce={nonce}
      />
    );
  } else if (item.copy) {
    body = (
      <div className="vtab-view">
        <div className="vtab-header">
          <span className="vtab-label">
            <strong>{copyTabTitle(item.copy.relPath, at)}</strong>
            {noteExists === false ? " · 이 노트는 여기에 더 이상 없어요. 내 버전이에요." : ""}
          </span>
        </div>
        <ReadOnlyText source={{ type: "copy", ...item.copy }} nonce={nonce} />
      </div>
    );
  } else {
    // A clash rename: the two sibling notes (the only other reviewable kind).
    const other = item.otherPath ?? item.path;
    body = (
      <CompareBody
        key={item.key}
        left={{ label: noteLabel(item.path), source: { type: "note", path: item.path } }}
        right={{ label: noteLabel(other), source: { type: "note", path: other } }}
        nonce={nonce}
      />
    );
  }

  const copy = item.copy;
  return (
    <div className="review-main">
      <div className="review-compare">{body}</div>
      <div className="review-actions">
        {resolution && <span className="health-pill">{RESOLUTION_LABEL[resolution]}</span>}
        {copy ? (
          <>
            <AsyncButton
              className="ghost-pill sm"
              title="노트를 그대로 두고 이 사본을 삭제해요."
              onClick={() =>
                run(async () => {
                  await deleteCopy(copy);
                  return "kept";
                })
              }
            >
              현재 버전 유지
            </AsyncButton>
            {noteExists && (
              <AsyncButton
                className="ghost-pill sm"
                title="이 사본의 텍스트를 노트에 넣고 사본을 삭제해요."
                onClick={() =>
                  run(async () => {
                    await restoreCopyReplace(copy, item.path);
                    await deleteCopy(copy);
                    openReviewTab();
                    return "restored";
                  })
                }
              >
                이 사본 복원
              </AsyncButton>
            )}
            <AsyncButton
              className="ghost-pill sm"
              title="이 사본의 텍스트로 원본 옆에 새 노트를 만들어요."
              onClick={() =>
                run(async () => {
                  await restoreCopyAsSibling(copy);
                  openReviewTab();
                  return "restoredSibling";
                })
              }
            >
              새 노트로 복원
            </AsyncButton>
            <button type="button" className="ghost-pill sm" onClick={() => openCopy(copy)}>
              사본 열기
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ghost-pill sm"
              onClick={() => void useStore.getState().openNoteByPath(item.path)}
            >
              노트 열기
            </button>
            {item.otherPath && (
              <button
                type="button"
                className="ghost-pill sm"
                onClick={() => void useStore.getState().openNoteByPath(item.otherPath!)}
              >
                다른 노트 열기
              </button>
            )}
            <AsyncButton className="ghost-pill sm" onClick={() => run(async () => "kept")}>
              둘 다 유지
            </AsyncButton>
          </>
        )}
        <AsyncButton
          className="ghost-pill sm"
          title={copy ? "검토 완료로 표시하고 사본은 .context/trash에 보관해요." : "검토 완료로 표시해요."}
          onClick={() => run(async () => "skipped")}
        >
          Skip
        </AsyncButton>
      </div>
      {error && (
        <p role="alert" className="auth-error vtab-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReviewTab() {
  const report = useReportItems();
  const resolved = useReviewState();
  const items = useMemo(() => reviewItems(report), [report]);
  const [selected, setSelected] = useState<string | null>(null);
  const [countNonce, setCountNonce] = useState(0);
  const counts = useLineCounts(items, countNonce);
  const [confirmAll, setConfirmAll] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const pending = pendingItems(items, resolved);

  const current =
    items.find((it) => it.key === selected) ??
    pending[0] ??
    items[0] ??
    null;

  const resolveCurrent = (how: Resolution) => {
    if (!current) return;
    const next = new Map(resolved);
    next.set(current.key, how);
    reviewState.set(next);
    setSelected(nextPendingKey(items, next, current.key) ?? current.key);
    setCountNonce((n) => n + 1);
  };

  const plan = planResolveAll(items, resolved);
  const resolveAll = async () => {
    setAllError(null);
    const failed: string[] = [];
    const next = new Map(resolved);
    for (const it of pending) {
      try {
        if (it.copy) await deleteCopy(it.copy);
        next.set(it.key, "kept");
      } catch (e) {
        failed.push(`${noteLabel(it.path)}: ${errText(e)}`);
      }
    }
    reviewState.set(next);
    setConfirmAll(false);
    if (failed.length) setAllError(`일부 사본을 삭제하지 못했어요. ${failed.join(" · ")}`);
  };

  return (
    <div className="review-tab">
      <div className="review-body">
        {current ? (
          <ItemView
            key={current.key}
            item={current}
            resolution={resolved.get(current.key)}
            onResolved={resolveCurrent}
          />
        ) : (
          <p className="muted vtab-status">이번 세션에서 검토할 항목이 없어요.</p>
        )}
      </div>
      <aside className="review-list" aria-label="검토할 변경 사항">
        <div className="review-list-header">
          <span>
            {pending.length === 0
              ? "모두 처리됨"
              : `검토할 항목 ${items.length.toLocaleString()}개 중 ${pending.length.toLocaleString()}개`}
          </span>
          {pending.length > 0 && (
            <button type="button" className="ghost-pill sm" onClick={() => setConfirmAll(true)}>
              모두 처리
            </button>
          )}
        </div>
        {allError && (
          <p role="alert" className="auth-error vtab-error">
            {allError}
          </p>
        )}
        <ul>
          {items.map((it) => {
            const how = resolved.get(it.key);
            const c = counts[it.key];
            return (
              <li key={it.key}>
                <button
                  type="button"
                  className={`review-row${current?.key === it.key ? " active" : ""}${how ? " resolved" : ""}`}
                  aria-current={current?.key === it.key}
                  onClick={() => setSelected(it.key)}
                >
                  <span className="health-pill">{RECONCILE_KIND_LABEL[it.kind]}</span>
                  <PathText path={it.path} />
                  <span className="review-row-meta muted">
                    {c ? formatLineChanges(c) : ""}
                    {c ? " · " : ""}
                    {how ? RESOLUTION_LABEL[how] : "대기 중"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {confirmAll && (
        <ConfirmDialog
          title="모든 변경 사항을 처리할까요?"
          confirmLabel="모두 처리"
          tone="danger"
          onConfirm={resolveAll}
          onCancel={() => setConfirmAll(false)}
        >
          {plan.copiesToDelete.length === 0
            ? `노트 ${pending.length.toLocaleString()}개의 현재 버전을 유지해요. 삭제되는 사본은 없어요.`
            : `대기 중인 모든 노트의 현재 버전을 유지해요. .context/trash에 있는 사본 ${plan.copiesToDelete.length.toLocaleString()}개는 이 기기에서 삭제돼요.`}
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Pending review items across this session's whole report (the panel badge). */
export function usePendingReviewCount(): number {
  const report = useReportItems();
  const resolved = useReviewState();
  return useMemo(() => pendingItems(reviewItems(report), resolved).length, [report, resolved]);
}
