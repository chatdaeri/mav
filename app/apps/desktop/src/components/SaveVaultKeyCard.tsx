// "중요: 볼트 키를 저장하세요" (owner decision 2026-11-01). Shown at the top
// of Vault Settings → General, only to the OWNER of an encrypted vault who would
// otherwise have no way back if this computer were lost: no password wrap of
// their account key, no other computer holding it, and no teammate holding the
// vault key. Not a popup: a card that stays until they act. Any action hides it
// (remembered on this device); setting a password removes the need entirely.
// Saving to a file or "I've saved it" is also recorded on the server
// (`reportSavedFlag.ts`); setting a password is not a key save.

import { useEffect, useState } from "react";
import { toast } from "../lib/toast";
import { api } from "../lib/auth/authManager";
import { currentVaultKeySession, onVaultKeyEvent, vaultKeysPasswordUnlock } from "../lib/vaultKeys/runtime";
import { recordVaultKeySaved, reportSavedFlagOnce, vaultKeySavedHere } from "../lib/vaultKeys/reportSavedFlag";
import { saveVaultKeyToFile } from "../lib/vaultKeys/saveKeyFile";
import { useStore } from "../store";
import { AsyncButton } from "./AsyncButton";
import { CopyField } from "./McpTab";

/** Local dev only (`VITE_PREVIEW_SAVE_KEY_CARD=1 pnpm run dev:desktop`): show the
 *  card on any vault this owner holds the key for, to review the design. */
const PREVIEW = import.meta.env.DEV && import.meta.env.VITE_PREVIEW_SAVE_KEY_CARD === "1";

export function SaveVaultKeyCard({ vaultId, vaultName }: { vaultId: string; vaultName: string }) {
  const userId = useStore((s) => s.session?.user.id ?? null);
  const [needed, setNeeded] = useState(false);
  const [canSetPassword, setCanSetPassword] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => onVaultKeyEvent(() => setRefresh((n) => n + 1)), []);

  useEffect(() => {
    let live = true;
    setNeeded(false);
    setShown(null);
    if (vaultKeySavedHere(vaultId) && !PREVIEW) {
      void reportSavedFlagOnce(vaultId);
      return;
    }
    void (async () => {
      const words = currentVaultKeySession()?.revealVaultKey(vaultId);
      if (!words) return; // not keyed here, or not the owner's device
      const [mine, me, hasPassword] = await Promise.all([
        api.getMyVaultKeys(vaultId).catch(() => null),
        api.getMyKeys().catch(() => null),
        api.hasPasswordLogin(),
      ]);
      if (!live || !mine || !mine.keyed || mine.pending || !me) return;
      const noWayBack =
        !me.privWrappedPassword && (me.devices?.length ?? 0) === 0 && (mine.otherKeyHolders ?? 1) === 0;
      setCanSetPassword(hasPassword === false || PREVIEW);
      setNeeded(noWayBack || PREVIEW);
    })();
    return () => {
      live = false;
    };
  }, [vaultId, refresh]);

  if (!needed) return null;

  const words = () => currentVaultKeySession()?.revealVaultKey(vaultId) ?? null;
  const saveToFile = async () => {
    if (await saveVaultKeyToFile(vaultId, vaultName)) setNeeded(false);
  };

  const confirmSaved = async () => {
    await recordVaultKeySaved(vaultId, "confirmed");
    setNeeded(false);
    toast("확인했어요.");
  };

  const setPassword = async () => {
    if (pw.length < 8) return toast("8자 이상으로 입력하세요.", "error");
    if (pw !== pw2) return toast("두 비밀번호가 일치하지 않아요.", "error");
    try {
      await api.setAccountPassword(pw);
      if (userId) await vaultKeysPasswordUnlock(userId, pw);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return;
    } finally {
      setPw("");
      setPw2("");
    }
    setSettingPassword(false);
    setNeeded(false);
    toast("비밀번호를 설정했어요. 이제 새 컴퓨터에서도 이 비밀번호로 볼트를 열 수 있어요.");
  };

  return (
    <section className="save-key-card" aria-label="볼트 키 저장">
      <div className="save-key-head">
        <span className="save-key-badge" aria-hidden="true">!</span>
        <div>
          <div className="save-key-title">중요: 볼트 키를 저장하세요</div>
          <p className="save-key-desc">
            이 볼트의 키는 내 기기에만 있어요. 이 컴퓨터를 잃어버리면 다시 들어가기 위해 키가 필요해요.
            비밀번호 관리자처럼 안전한 곳에 사본을 보관하세요.
          </p>
          <p className="save-key-desc">
            새 컴퓨터에서 쓰려면 볼트를 열고 '볼트 키로 복원'을 선택하세요.
          </p>
        </div>
      </div>
      <div className="save-key-actions">
        <AsyncButton className="primary sm" onClick={saveToFile}>
          파일로 저장
        </AsyncButton>
        <button type="button" className="secondary sm" onClick={() => setShown(shown ? null : words())}>
          {shown ? "키 숨기기" : "키 보기"}
        </button>
        {canSetPassword && (
          <button type="button" className="secondary sm" onClick={() => setSettingPassword((v) => !v)}>
            대신 비밀번호 설정
          </button>
        )}
      </div>
      {shown && (
        <div className="save-key-panel">
          <CopyField value={shown} label="볼트 키" wrap sensitive />
          <AsyncButton className="ghost sm" onClick={confirmSaved}>
            저장했어요
          </AsyncButton>
        </div>
      )}
      {settingPassword && (
        <div className="save-key-panel">
          <p className="save-key-desc">
            마이 세컨드 브레인 비밀번호가 있으면 새 컴퓨터에서 볼트를 열 수 있어요. Google 로그인과 함께 이 비밀번호로도 로그인할 수 있어요.
          </p>
          <input type="password" placeholder="새 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <input type="password" placeholder="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          <AsyncButton className="primary sm" onClick={setPassword}>
            비밀번호 설정
          </AsyncButton>
        </div>
      )}
    </section>
  );
}
