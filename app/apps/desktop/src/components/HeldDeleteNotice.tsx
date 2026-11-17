import { useState } from "react";
import { Banner } from "./Banner";
import { useStore } from "../store";
import { useNoticeSlot } from "./useNoticeSlot";

/**
 * Many notes were removed from the vault folder at once with the app open
 * (#221). Past the blast-radius cap a disk delete is NEVER sent to the team:
 * deleting for everyone happens inside the app, where the creator-only rule
 * applies. So this only informs. "지금 복원" brings them back at once;
 * Dismiss, or the fade, releases the hold and the next pull restores them.
 * The fade waits while 지금 복원 is in flight.
 */
export function HeldDeleteNotice() {
  const pending = useStore((s) => s.structureNotice.pendingDelete);
  const [busy, setBusy] = useState(false);
  const release = (how: "restore" | "dismiss") => {
    setBusy(true);
    void useStore
      .getState()
      .releaseBulkDelete(how)
      .catch((e) => console.warn("[sync] bulk delete release failed", e))
      .finally(() => setBusy(false));
  };
  const visible = useNoticeSlot("held-delete", pending != null, {
    onFade: () => release("dismiss"),
    hold: busy,
  });
  const n = pending?.count ?? 0;
  return (
    <Banner show={visible} role="status">
      <span>
        이 기기에서 노트 {n.toLocaleString()}개를 삭제했어요. 팀에는 그대로 남아 있고 여기에도 다시
        복원돼요.
      </span>
      <div className="banner-actions">
        <button className="primary" disabled={busy} onClick={() => release("restore")}>
          지금 복원
        </button>
        <button className="secondary" disabled={busy} onClick={() => release("dismiss")}>
          닫기
        </button>
      </div>
    </Banner>
  );
}
