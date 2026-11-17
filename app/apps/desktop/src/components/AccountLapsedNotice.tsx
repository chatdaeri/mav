import { useEffect, useState } from "react";
import { Banner } from "./Banner";
import { useNoticeSlot } from "./useNoticeSlot";
import { authManager } from "../lib/auth/authManager";
import { hasBillingLapsedLock } from "../lib/locks";
import { syncManager } from "../lib/sync/docSession";
import { toast } from "../lib/toast";
import type { Share } from "../lib/api";
import { useStore } from "../store";

export const ACCOUNT_LAPSED_COPY =
  "Team 구독이 종료되었어요. 이 볼트는 읽기 전용으로만 동기화되고, 파일은 이 기기에서 계속 편집할 수 있어요.";
export const ACCOUNT_LAPSED_MEMBER_COPY = "볼트 소유자에게 플랜을 다시 시작해 달라고 요청하세요.";

/**
 * Should the lapsed-Team notice be up? Either signal is enough: the server's
 * synthetic `billing_lapsed` vault lock (read on every locks refresh), or a 402
 * `account_read_only` the sync layer met this run (before the next refresh).
 */
export function accountLapsedNotice(args: {
  syncEnabled: boolean;
  locks: readonly Share[];
  accountReadOnly: boolean;
}): boolean {
  if (!args.syncEnabled) return false;
  return args.accountReadOnly || hasBillingLapsedLock(args.locks);
}

/**
 * Presentational strip. The manager variant carries a pending choice (Resume
 * plan / Manage plan) and never fades; the member variant is informational.
 */
export function AccountLapsedNoticeView({
  show,
  canManage,
  busy,
  onResume,
  onManage,
  onDismiss,
}: {
  show: boolean;
  canManage: boolean;
  busy: boolean;
  onResume: () => void;
  onManage: () => void;
  onDismiss: () => void;
}) {
  return (
    <Banner show={show} className="account-lapsed-banner" role="alert">
      <span>
        {ACCOUNT_LAPSED_COPY}
        {!canManage && ` ${ACCOUNT_LAPSED_MEMBER_COPY}`}
      </span>
      <div className="banner-actions">
        {canManage ? (
          <>
            <button className="primary" disabled={busy} onClick={onResume}>
              플랜 다시 시작
            </button>
            <button disabled={busy} onClick={onManage}>
              플랜 관리
            </button>
          </>
        ) : (
          <button onClick={onDismiss}>닫기</button>
        )}
      </div>
    </Banner>
  );
}

/**
 * The Team account behind the open vault lapsed (`lib/noticeSlot.ts`
 * "account-lapsed"). The registry flag is read on the same re-render trigger as
 * the note-limit strip: every run's progress.
 */
export function AccountLapsedNotice() {
  const syncEnabled = useStore((s) => s.syncEnabled);
  const locks = useStore((s) => s.locks);
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  useStore((s) => s.syncProgress);
  const accountReadOnly = syncManager.registry.isAccountReadOnly();
  const wants = accountLapsedNotice({ syncEnabled, locks, accountReadOnly });

  // Manager = the caller's own billing account holds this vault and they can
  // manage it. Anything else (a member, an admin of someone else's account, a
  // failed read) gets the informational variant.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    if (!wants || !orgId) {
      setCanManage(false);
      return;
    }
    let live = true;
    authManager.api
      .getBillingAccount()
      .then((a) => {
        if (live) setCanManage(a.canManage && a.vaults.some((v) => v.orgId === orgId));
      })
      .catch(() => {
        if (live) setCanManage(false);
      });
    return () => {
      live = false;
    };
  }, [wants, orgId]);

  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = !canManage && dismissedFor === (orgId ?? "");
  const dismiss = () => setDismissedFor(orgId ?? "");
  const [busy, setBusy] = useState(false);

  const visible = useNoticeSlot(
    "account-lapsed",
    wants && !dismissed,
    canManage ? {} : { onFade: dismiss },
  );

  const resume = async () => {
    setBusy(true);
    try {
      await authManager.api.accountResume();
      await useStore.getState().refreshLocks();
      toast("Team 플랜을 다시 시작했어요.");
    } catch (e) {
      toast(`플랜을 다시 시작하지 못했어요: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountLapsedNoticeView
      show={visible}
      canManage={canManage}
      busy={busy}
      onResume={() => void resume()}
      onManage={() => useStore.getState().requestAccountSettings("plan")}
      onDismiss={dismiss}
    />
  );
}
