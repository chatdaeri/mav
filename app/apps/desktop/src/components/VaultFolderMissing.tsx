import { Banner } from "./Banner";
import { AsyncButton } from "./AsyncButton";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The open vault's folder is missing (#228): moved, renamed or deleted outside
 * the app. One vocabulary everywhere it is shown — the in-vault banner, the
 * Settings → Vaults row and the Set-up prompt — and one recovery path behind
 * it (`store.restoreVaultFolder` / `store.locateVaultFolder`).
 */
export const FOLDER_MISSING_TITLE = "이 볼트의 폴더를 찾을 수 없어요.";
export const FOLDER_MISSING_DETAIL = "폴더가 이동·이름 변경·삭제된 것 같아요.";
export const FOLDER_MISSING_BADGE = "폴더 없음";
export const RESTORE_HERE = "여기에 복원";
export const LOCATE_FOLDER = "폴더 찾기…";
export const SWITCH_VAULT = "볼트 전환";

/**
 * Which recovery actions apply. Restore here needs a Remote Vault to sync the
 * folder back down from, so a local-only vault gets Locate folder… alone.
 */
export function folderMissingActions(synced: boolean): Array<"restore" | "locate"> {
  return synced ? ["restore", "locate"] : ["locate"];
}

export function VaultFolderMissingBannerView({
  show,
  synced,
  busy = false,
  onRestore,
  onLocate,
  onSwitch,
}: {
  show: boolean;
  /** The vault has a Remote Vault (sync on) — Restore here is offered. */
  synced: boolean;
  busy?: boolean;
  onRestore: () => Promise<unknown> | unknown;
  onLocate: () => Promise<unknown> | unknown;
  onSwitch: () => void;
}) {
  const actions = folderMissingActions(synced);
  return (
    <Banner show={show} className="vault-folder-missing-banner" role="alert">
      <span>
        <strong>{FOLDER_MISSING_TITLE}</strong> {FOLDER_MISSING_DETAIL}
      </span>
      <div className="banner-actions">
        {actions.includes("restore") && (
          <AsyncButton className="primary" spinnerTone="on-accent" disabled={busy} onClick={onRestore}>
            {RESTORE_HERE}
          </AsyncButton>
        )}
        <AsyncButton
          className={actions.includes("restore") ? undefined : "primary"}
          disabled={busy}
          onClick={onLocate}
        >
          {LOCATE_FOLDER}
        </AsyncButton>
        <button type="button" className="link-btn" disabled={busy} onClick={onSwitch}>
          {SWITCH_VAULT}
        </button>
      </div>
    </Banner>
  );
}

/**
 * The same state on a Settings → Vaults row: a "폴더 없음" badge where
 * "Current" would be, followed by the same actions as the banner.
 */
export function VaultFolderMissingRowActions({
  synced,
  busy = false,
  onRestore,
  onLocate,
}: {
  synced: boolean;
  busy?: boolean;
  onRestore: () => Promise<unknown> | unknown;
  onLocate: () => Promise<unknown> | unknown;
}) {
  const actions = folderMissingActions(synced);
  return (
    <>
      <span className="member-role folder-missing">{FOLDER_MISSING_BADGE}</span>
      {actions.includes("restore") && (
        <AsyncButton className="link-btn" disabled={busy} onClick={onRestore}>
          {RESTORE_HERE}
        </AsyncButton>
      )}
      <AsyncButton className="link-btn" disabled={busy} onClick={onLocate}>
        {LOCATE_FOLDER}
      </AsyncButton>
    </>
  );
}

/** How many unsynced paths the reset warning names before "and N more". */
export const RESET_LIST_MAX = 5;

/**
 * Copy for the Reset local copy confirm (#228). With notes the server has not
 * confirmed, the dialog names them and the button says what it costs.
 */
export function resetLocalCopyCopy(unsynced: readonly string[]): {
  title: string;
  body: string;
  warning: string | null;
  shown: string[];
  more: number;
  confirmLabel: string;
} {
  const n = unsynced.length;
  return {
    title: "이 기기의 볼트를 초기화할까요?",
    body:
      "마이 세컨드 브레인이 이 기기의 볼트 폴더를 영구 삭제하고 원격 볼트에서 새 사본을 내려받아요. 팀에는 아무 영향이 없어요.",
    warning:
      n === 0
        ? null
        : `서버에 반영되지 않은 변경 사항이 있는 노트가 ${n}개 있어요. 초기화하면 사라져요.`,
    shown: unsynced.slice(0, RESET_LIST_MAX),
    more: Math.max(0, n - RESET_LIST_MAX),
    confirmLabel: n === 0 ? "초기화" : "삭제 후 초기화",
  };
}

export function ResetLocalCopyDialog({
  unsynced,
  error,
  onConfirm,
  onCancel,
}: {
  unsynced: readonly string[];
  error?: string | null;
  onConfirm: () => Promise<unknown> | unknown;
  onCancel: () => void;
}) {
  const copy = resetLocalCopyCopy(unsynced);
  return (
    <ConfirmDialog
      title={copy.title}
      confirmLabel={copy.confirmLabel}
      tone="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>{copy.body}</p>
      {copy.warning && (
        <>
          <p>
            <strong>{copy.warning}</strong>
          </p>
          <ul className="reset-unsynced-list">
            {copy.shown.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
            {copy.more > 0 && <li className="muted">외 {copy.more}개</li>}
          </ul>
        </>
      )}
      {error && <div className="auth-error">{error}</div>}
    </ConfirmDialog>
  );
}
