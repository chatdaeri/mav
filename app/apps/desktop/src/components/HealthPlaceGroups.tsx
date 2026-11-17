/* Vault Settings → Health — the two "where does it live" groups under Needs
   attention: "Only on this computer" and "Only on the Remote Vault". Each is one
   group in the same style as the issue groups, holding notes, then folders,
   then files (alphabetical within each), one line per item with a type icon
   and the item's action. Paths an issue already lists never reach here — the
   caller passes the inventory through `dedupeDifferences` first. */
import { useState } from "react";
import type { HealthActions, HealthInventory } from "../lib/health/types";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { Glyph, type GlyphName } from "./HealthShared";

/** Rows shown before "Show more". */
const PAGE = 20;

type PlaceKind = "note" | "folder" | "file";
interface PlaceRow {
  kind: PlaceKind;
  path: string;
}

const KIND_ICON: Record<PlaceKind, GlyphName> = { note: "note", folder: "folder", file: "file" };
const KIND_LABEL: Record<PlaceKind, string> = { note: "노트", folder: "폴더", file: "파일" };

/** Notes, then folders, then files; alphabetical within each. */
export function placeRows(notes: string[], folders: string[], files: string[]): PlaceRow[] {
  const sorted = (paths: string[], kind: PlaceKind) =>
    [...paths].sort((a, b) => a.localeCompare(b)).map((path) => ({ kind, path }));
  return [...sorted(notes, "note"), ...sorted(folders, "folder"), ...sorted(files, "file")];
}

const count = (n: number) => `${n.toLocaleString()}개 항목`;

function RowLabel({ row }: { row: PlaceRow }) {
  return (
    <span className="health-place-row" title={row.path}>
      <span className="health-place-kind" aria-label={KIND_LABEL[row.kind]}>
        <Glyph name={KIND_ICON[row.kind]} size={14} />
      </span>
      <span className="health-missing-path">{row.path}</span>
    </span>
  );
}

/** One line in whichever group holds Team-blocked files. */
export const PRO_FILES_LINE =
  "PDF, 이미지 등 다른 파일은 Team 요금제에서만 동기화돼요. 노트와 폴더는 모든 요금제에서 동기화돼요.";

/** "2 notes, 1 folder, 3 files" — the confirm names exactly what goes. */
export function describeSelection(rows: PlaceRow[]): string {
  const n = (kind: PlaceKind) => rows.filter((r) => r.kind === kind).length;
  const part = (count: number, unit: string) =>
    count > 0 ? `${unit} ${count.toLocaleString()}개` : null;
  return [part(n("note"), "노트"), part(n("folder"), "폴더"), part(n("file"), "파일")]
    .filter(Boolean)
    .join(", ");
}

const rowKey = (row: PlaceRow) => `${row.kind}:${row.path}`;

/** Checkbox + icon + path, or an empty checkbox slot so rows stay aligned. */
function SelectableRow({
  row,
  selectable,
  checked,
  onToggle,
}: {
  row: PlaceRow;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="health-missing-row">
      {selectable ? (
        <input
          type="checkbox"
          className="health-issue-check"
          checked={checked}
          onChange={onToggle}
          aria-label={`${row.path} 선택`}
        />
      ) : (
        <span className="health-place-checkslot" aria-hidden="true" />
      )}
      <RowLabel row={row} />
    </label>
  );
}

function useSelection(rows: PlaceRow[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const live = new Map(rows.map((r) => [rowKey(r), r]));
  const picked = [...selected].map((k) => live.get(k)).filter((r): r is PlaceRow => r != null);
  const toggle = (row: PlaceRow) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = rowKey(row);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const drop = (paths: string[]) =>
    setSelected((prev) => {
      const gone = new Set(paths);
      return new Set([...prev].filter((k) => !gone.has(k.slice(k.indexOf(":") + 1))));
    });
  return { selected, setSelected, picked, toggle, drop };
}

export function LocalOnlyGroup({
  inventory,
  actions,
  filesBlocked,
  onOpen,
  onShow,
  stale,
}: {
  inventory: HealthInventory;
  actions: HealthActions;
  /** Syncing standalone files needs Team here. */
  filesBlocked: boolean;
  onOpen: (path: string) => void;
  onShow: (path: string) => void;
  stale: boolean;
}) {
  const rows = placeRows(inventory.deviceOnlyNotes, inventory.deviceOnlyFolders, inventory.deviceOnlyFiles);
  const [limit, setLimit] = useState(PAGE);
  const sel = useSelection(rows);
  const [confirmDelete, setConfirmDelete] = useState<PlaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const files = inventory.deviceOnlyFiles;
  const canSync =
    inventory.deviceOnlyNotes.length + inventory.deviceOnlyFolders.length > 0 ||
    (!filesBlocked && files.length > 0);
  const allPicked = sel.picked.length === rows.length;

  return (
    <div className="health-difference-group health-place-group">
      <div className="health-difference-grouphead">
        <h4>{`이 컴퓨터에만 있음 · ${count(rows.length)}${stale ? " (마지막으로 확인한 상태)" : ""}`}</h4>
        <div className="health-group-actions">
          {canSync && (
            <AsyncButton
              className="ghost-pill sm"
              onClick={async () => {
                if (!filesBlocked && files.length > 0) await actions.retryLocalFiles(files);
                await actions.syncNow();
              }}
            >
              다시 확인
            </AsyncButton>
          )}
          <button
            type="button"
            className="ghost-pill sm"
            onClick={() => sel.setSelected(allPicked ? new Set() : new Set(rows.map(rowKey)))}
          >
            {allPicked ? "선택 해제" : "모두 선택"}
          </button>
          {sel.picked.length > 0 && (
            <button
              type="button"
              className="ghost-pill sm danger"
              onClick={() => { setError(null); setConfirmDelete(sel.picked); }}
            >
              {`선택 항목 삭제 (${sel.picked.length.toLocaleString()})`}
            </button>
          )}
        </div>
      </div>
      {filesBlocked && files.length > 0 && <p>{PRO_FILES_LINE}</p>}
      {error && !confirmDelete && <p role="alert" className="auth-error health-missing-error">{error}</p>}
      <ul>
        {rows.slice(0, limit).map((row) => (
          <li key={rowKey(row)}>
            <SelectableRow
              row={row}
              selectable
              checked={sel.selected.has(rowKey(row))}
              onToggle={() => sel.toggle(row)}
            />
            <span className="health-missing-actions">
              {row.kind === "file" && filesBlocked && <span className="health-pro-tag">Team</span>}
              <button
                type="button"
                className="ghost-pill sm"
                onClick={() => (row.kind === "note" ? onOpen(row.path) : onShow(row.path))}
              >
                {row.kind === "note" ? "열기" : "보기"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="link-btn" onClick={() => setLimit(limit + PAGE)}>
          {`더 보기 (${(rows.length - limit).toLocaleString()}개 남음)`}
        </button>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`이 컴퓨터에서 ${describeSelection(confirmDelete)}를 삭제할까요?`}
          confirmLabel="삭제"
          onCancel={() => { setConfirmDelete(null); setError(null); }}
          onConfirm={async () => {
            setError(null);
            try {
              // The same path-safe delete the Health "Delete" remedy runs
              // (server row first, then disk; folders go recursively).
              const { deleted, failed } = await actions.deleteLocalFiles(confirmDelete.map((r) => r.path));
              sel.drop(deleted);
              if (failed.length > 0) {
                setError(failed.map((f) => `${f.path}: ${f.reason}`).join("\n"));
                return;
              }
              setConfirmDelete(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {error && <p role="alert" className="auth-error">{error}</p>}
          <p>
            이 항목들은 이 컴퓨터에만 있어요(원격 볼트에는 사본이 없어요). 삭제하면
            영구히 사라지니, 필요하면 먼저 사본을 저장해 두세요.
          </p>
          {confirmDelete.some((r) => r.kind === "folder") && (
            <p>폴더는 안에 든 모든 항목과 함께 삭제돼요.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

export function RemoteOnlyGroup({
  inventory,
  actions,
  downloadsBlocked,
  showCheckAgain,
  stale,
}: {
  inventory: HealthInventory;
  actions: HealthActions;
  /** Downloading standalone files needs Team here. */
  downloadsBlocked: boolean;
  showCheckAgain: boolean;
  stale: boolean;
}) {
  const rows = placeRows(inventory.serverOnlyNotes, inventory.serverOnlyFolders, inventory.serverOnlyFiles);
  const [limit, setLimit] = useState(PAGE);
  const sel = useSelection(rows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remove, setRemove] = useState<string[] | null>(null);
  if (rows.length === 0) return null;
  const files = inventory.serverOnlyFiles;
  const pickedFiles = sel.picked.filter((r) => r.kind === "file").map((r) => r.path);

  const download = async (paths: string[]) => {
    setError(null);
    setNotice(null);
    try {
      await actions.downloadFiles(paths);
      setNotice("다운로드를 마쳤어요.");
      sel.drop(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="health-difference-group health-place-group">
      <div className="health-difference-grouphead">
        <h4>{`원격 볼트에만 있음 · ${count(rows.length)}${stale ? " (마지막으로 확인한 상태)" : ""}`}</h4>
        <div className="health-group-actions">
          {showCheckAgain && (
            <AsyncButton className="ghost-pill sm" onClick={() => actions.syncNow()}>
              다시 확인
            </AsyncButton>
          )}
          {files.length > 0 && !downloadsBlocked && pickedFiles.length === 0 && (
            <AsyncButton className="ghost-pill sm" onClick={() => download(files)}>
              모두 다운로드
            </AsyncButton>
          )}
          {pickedFiles.length > 0 && !downloadsBlocked && (
            <AsyncButton className="ghost-pill sm" onClick={() => download(pickedFiles)}>
              {`선택 항목 다운로드 (${pickedFiles.length.toLocaleString()})`}
            </AsyncButton>
          )}
          {pickedFiles.length > 0 && (
            <button
              type="button"
              className="ghost-pill sm danger"
              onClick={() => { setError(null); setRemove(pickedFiles); }}
            >
              {`서버에서 제거 (${pickedFiles.length.toLocaleString()})`}
            </button>
          )}
        </div>
      </div>
      {downloadsBlocked && files.length > 0 && <p>{PRO_FILES_LINE}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && !remove && <p role="alert" className="auth-error health-missing-error">{error}</p>}
      <ul>
        {rows.slice(0, limit).map((row) => (
          <li key={rowKey(row)}>
            <SelectableRow
              row={row}
              selectable={row.kind === "file"}
              checked={sel.selected.has(rowKey(row))}
              onToggle={() => sel.toggle(row)}
            />
            {row.kind === "file" && (
              <span className="health-missing-actions">
                {downloadsBlocked ? (
                  <span className="health-pro-tag">Team</span>
                ) : (
                  <AsyncButton className="ghost-pill sm" onClick={() => download([row.path])}>
                    다운로드
                  </AsyncButton>
                )}
                <button
                  type="button"
                  className="ghost-pill sm danger"
                  onClick={() => { setError(null); setRemove([row.path]); }}
                >
                  서버에서 제거
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="link-btn" onClick={() => setLimit(limit + PAGE)}>
          {`더 보기 (${(rows.length - limit).toLocaleString()}개 남음)`}
        </button>
      )}
      {remove && (
        <ConfirmDialog
          title={
            remove.length === 1
              ? "이 파일을 서버에서 제거할까요?"
              : `파일 ${remove.length.toLocaleString()}개를 서버에서 제거할까요?`
          }
          confirmLabel="서버에서 제거"
          onCancel={() => { setRemove(null); setError(null); }}
          onConfirm={async () => {
            setError(null);
            const failed: string[] = [];
            const done: string[] = [];
            for (const path of remove) {
              try {
                await actions.removeServerFile(path);
                done.push(path);
              } catch (e) {
                failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            sel.drop(done);
            if (failed.length > 0) {
              setError(failed.join("\n"));
              return;
            }
            setRemove(null);
          }}
        >
          {error && <p role="alert" className="auth-error">{error}</p>}
          <p>
            {remove.length === 1 ? <code>{remove[0]}</code> : `파일 ${remove.length.toLocaleString()}개`}
            {remove.length === 1 ? "을(를)" : "를"} 원격 볼트에서 영구히 제거해요. 다른 멤버는 접근할 수 없게 되고,
            동기화된 기기에서도 사본이 삭제될 수 있어요. 되돌릴 수 없으니, 필요하면 먼저
            사본을 저장해 두세요.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
