// Vault Settings → General → Vault key / Encryption (owners and admins).
//
// Hidden by default; "Show vault key" reveals the 24 words inline with Copy
// and Save to file (owner only). Never emailed or sent anywhere: the words
// leave this screen only through the clipboard or a file the owner picks.
// When the vault is keyed but this device has no verified key for it, the same
// place offers the owner "Restore with vault key" (a wrong key is refused,
// never stored).
// Every vault is encrypted automatically (no opt-in, no review): an unkeyed
// vault shows nothing here. What to show is decided by
// `vaultKeySectionView`; an unknown state shows nothing. While a keyed vault's
// older content is still being converted (the server's `fullyEncrypted:
// false`), one more line says so (`conversionLine`); once sealed, none.

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "../lib/toast";
import { syncManager } from "../lib/sync/docSession";
import { api } from "../lib/auth/authManager";
import {
  currentVaultKeySession,
  onVaultKeyEvent,
  vaultKeyStateFor,
} from "../lib/vaultKeys/runtime";
import { conversionLine, vaultKeySectionView } from "../lib/vaultKeys/sectionView";
import { saveVaultKeyToFile } from "../lib/vaultKeys/saveKeyFile";
import { recordVaultKeySaved } from "../lib/vaultKeys/reportSavedFlag";
import { AsyncButton } from "./AsyncButton";
import { CopyField } from "./McpTab";

const RESTORE_MESSAGES: Record<string, string> = {
  restored: "이 컴퓨터에 볼트 키를 복원했어요.",
  "invalid-words": "유효한 키 단어 24개가 아니에요. 각 단어를 확인하세요.",
  "wrong-key": "이 볼트의 키가 아니에요. 아무것도 바뀌지 않았어요.",
  "cannot-verify": "서버가 지금은 키를 확인할 수 없어요. 나중에 다시 시도해 주세요.",
  "security-warning": "보안 키가 이 컴퓨터와 맞지 않아요. 키 사용이 일시 중지됐어요.",
  disabled: "이 서버는 아직 볼트 키를 지원하지 않아요.",
};

export function VaultKeySection({
  vaultName,
  isOwner,
  canManage,
}: {
  vaultName: string;
  isOwner: boolean;
  canManage: boolean;
}) {
  const vaultId = syncManager.registry.vaultId;
  const session = currentVaultKeySession();
  const [shown, setShown] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [fullyEncrypted, setFullyEncrypted] = useState<boolean | undefined>(undefined);
  const [, bump] = useState(0);
  // Revealed words belong to ONE vault: a vault switch hides them (they must
  // never be shown under another vault's name).
  useEffect(() => {
    setShown(null);
    setRestoreText("");
    setRestoring(false);
  }, [vaultId]);
  useEffect(() => {
    const off = onVaultKeyEvent((e) => {
      if (e.kind === "vault") bump((n) => n + 1);
    });
    return () => void off();
  }, []);
  const keyedState = vaultId ? vaultKeyStateFor(vaultId)?.state : undefined;
  useEffect(() => {
    // Conversion progress, read once per open of this section (the server
    // reports what its background worker last recorded).
    setFullyEncrypted(undefined);
    if (!vaultId || !keyedState || keyedState === "unkeyed" || keyedState === "disabled") return;
    let live = true;
    api
      .getMyVaultKeys(vaultId)
      .then((mine) => {
        if (live && mine.keyed && !mine.pending) setFullyEncrypted(mine.fullyEncrypted);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [vaultId, keyedState]);
  if (!vaultId || !session) return null;
  const words = isOwner ? session.revealVaultKey(vaultId) : null;
  const state = vaultKeyStateFor(vaultId);
  const view = vaultKeySectionView({ hasWords: !!words, state, isOwner, canManage });
  const converting = conversionLine({ state, isOwner, canManage, fullyEncrypted });

  if (view === "hidden") {
    // An admin (not the owner) of an encrypted vault still sees its status.
    return state?.state === "ready" ? <EncryptionCard converting={converting} /> : null;
  }
  const saveKeyFile = () => saveVaultKeyToFile(vaultId, vaultName);
  const confirmSaved = async () => {
    await recordVaultKeySaved(vaultId, "confirmed");
    toast("확인했어요.");
    setShown(null);
  };

  return (
    <EncryptionCard converting={converting}>
      <div className="encryption-key-row">
        <KeyIcon />
        <span className="encryption-key-text">
          <b>볼트 키</b>
          <span>
            {words
              ? "새 컴퓨터에서 이 볼트를 여는 24개 단어예요. 이 단어가 있으면 누구나 볼트를 읽을 수 있어요."
              : "이 컴퓨터에는 아직 이 볼트의 키가 없어요. 보통 팀원의 컴퓨터가 자동으로 공유해 줘요."}
          </span>
        </span>
        {words && !shown && (
          <>
            <AsyncButton className="secondary sm" onClick={saveKeyFile}>
              파일로 저장
            </AsyncButton>
            <button type="button" className="encryption-ink-btn" onClick={() => setShown(words)}>
              볼트 키 보기
            </button>
          </>
        )}
        {!words && !restoring && (
          <button type="button" className="encryption-ink-btn" onClick={() => setRestoring(true)}>
            볼트 키로 복원
          </button>
        )}
      </div>

      {words && shown && (
        <div className="vault-key-panel">
          <CopyField value={shown} label="볼트 키" wrap sensitive />
          <div className="row">
            <AsyncButton className="secondary sm" onClick={saveKeyFile}>
              파일로 저장
            </AsyncButton>
            <button type="button" className="secondary sm" onClick={() => setShown(null)}>
              숨기기
            </button>
            <AsyncButton className="ghost sm" onClick={confirmSaved}>
              저장했어요
            </AsyncButton>
          </div>
        </div>
      )}

      {!words && restoring && (
        <div className="vault-key-panel">
          <textarea
            className="vault-key-input"
            value={restoreText}
            rows={3}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="이 볼트 키의 단어 24개를 붙여 넣으세요"
            aria-label="볼트 키"
            onChange={(e) => setRestoreText(e.target.value)}
          />
          <div className="row">
            <AsyncButton
              className="primary sm"
              disabled={!restoreText.trim()}
              onClick={async () => {
                const result = await session.restoreWithVaultKey(vaultId, restoreText);
                toast(RESTORE_MESSAGES[result] ?? result, result === "restored" ? "success" : "error");
                if (result === "restored") {
                  setRestoreText("");
                  setRestoring(false);
                  bump((n) => n + 1);
                }
              }}
            >
              복원
            </AsyncButton>
            <button
              type="button"
              className="secondary sm"
              onClick={() => {
                setRestoring(false);
                setRestoreText("");
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </EncryptionCard>
  );
}

function KeyIcon() {
  return (
    <svg className="encryption-key-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
    </svg>
  );
}

/**
 * The encrypted vault's status card under its own "Security" heading (the last
 * section of General), with the conversion line while older content is still
 * being checked. `children` is the owner's key row (and its reveal or restore
 * panel), at the card's foot.
 * Copy rule: never "end-to-end" or "zero-knowledge" (docs/VAULT_KEYS.md).
 */
function EncryptionCard({ converting, children }: { converting: string | null; children?: ReactNode }) {
  return (
    <div data-settings-section="security">
      <div className="menu-sep" />
      <div className="subhead">보안</div>
      <section className="encryption-card" aria-label="암호화">
        <div className="encryption-card-main">
          <span className="encryption-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div className="encryption-card-body">
            <div className="encryption-card-title">
              암호화됨 <span className="encryption-pill">팀이 키를 보관</span>
            </div>
            <p className="encryption-card-desc">
              이 볼트는 팀의 기기만 가진 키로 암호화돼요.
            </p>
            {converting && <p className="encryption-card-converting">{converting}</p>}
          </div>
        </div>
        {children && <div className="encryption-card-foot">{children}</div>}
      </section>
    </div>
  );
}
