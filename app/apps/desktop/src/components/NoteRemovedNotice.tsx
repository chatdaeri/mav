import { Banner } from "./Banner";
import { useStore } from "../store";
import { useNoticeSlot } from "./useNoticeSlot";

/**
 * A teammate (or an AI) deleted the note that was open, or the user's access to
 * it was removed, and we applied it here.
 *
 * Separate from the on-disk "was deleted" notice: that one means "the file
 * vanished from under us" and can only offer to close the note. This one knows
 * the server confirmed a deliberate deletion or access removal. It fades like
 * Dismiss; the removal stays in Activity.
 */
export function NoteRemovedNotice() {
  const removed = useStore((s) => s.noteRemovedByTeammate);
  const dismiss = () => useStore.setState({ noteRemovedByTeammate: null });
  const visible = useNoticeSlot("note-removed", removed != null, { onFade: dismiss });
  return (
    <Banner show={visible} tone="danger">
      <span>
        {removed?.reason === "revoked" ? (
          <>이 노트에 대한 권한이 제거됐어요. 이 기기에서도 삭제됐어요.</>
        ) : (
          <>팀원이 이 노트를 삭제했어요. 이 기기에서도 완전히 삭제됐어요.</>
        )}
      </span>
      <div className="banner-actions">
        <button className="primary" onClick={dismiss}>
          닫기
        </button>
      </div>
    </Banner>
  );
}
