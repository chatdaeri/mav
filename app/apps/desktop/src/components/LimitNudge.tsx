import { teamVaultLimitCopy, vaultLimitReason, type LimitKind } from "../lib/billing";
import { useStore } from "../store";

/**
 * Inline upgrade nudge shown in the create-vault / invite-member error slot
 * when the server rejects with a 402 free-plan limit. Styled with --warning-soft
 * (reserved for upgrade nudges), not the danger palette — this isn't an error.
 */
export function LimitNudge({
  kind,
  limit,
  onUpgrade,
}: {
  kind: LimitKind;
  limit: number | null;
  onUpgrade: () => void;
}) {
  const freeLimits = useStore((s) => s.billingConfig?.freeLimits);
  const teamMode = useStore((s) => s.billingConfig?.model === "team");
  // The server is the authority (the 402 carries `limit`, and billingConfig
  // reports both caps); these are last-resort defaults for a nudge rendered
  // before either arrived. Kept separate per kind so the two caps can move
  // independently (members were 10 for a while; both are 3 since 2026-09-09).
  const n =
    limit ??
    (kind === "note_limit" ? 20000 : kind === "member_limit"
      ? (freeLimits?.membersPerVault ?? 3)
      : (freeLimits?.vaultsPerUser ?? (teamMode ? 1 : 3)));
  // Team model: no per-vault upgrade to "make room"; the account upgrades, and
  // the button opens the plan comparison right here rather than a settings tab.
  const teamVault = teamMode && kind === "vault_limit";
  const message = teamVault
    ? teamVaultLimitCopy(n)
    : kind === "note_limit" ? (teamMode ? "이 볼트가 동기화 한도에 도달했어요. 팀 플랜으로 업그레이드하면 한도가 풀려요." : `무료 볼트가 동기화 노트 ${n.toLocaleString()}개 한도에 도달했어요. 팀 플랜으로 업그레이드하면 더 동기화할 수 있어요. 추가 노트는 이 기기에만 남아요.`) : kind === "member_limit"
      ? `무료 플랜 한도에 도달했어요. 이 볼트는 멤버 ${n}명까지 가능해요.`
      : // The cap counts FREE vaults only: a Team vault leaves the count, so
        // upgrading one of them opens a slot for another free vault.
        `무료 볼트 ${n}개를 모두 사용 중이에요. 하나를 팀 계정(좌석당 월 $10, 최소 3석)으로 옮기면 새 볼트를 만들 수 있어요. 팀 볼트는 이 한도에 포함되지 않아요.`;
  return (
    <div className="limit-nudge">
      <span>{message}</span>
      {teamVault ? (
        <button
          className="link-btn"
          onClick={() => useStore.getState().requestUpgradeDialog({ reason: vaultLimitReason(n) })}
        >
          팀 플랜으로 업그레이드
        </button>
      ) : (
        <button className="link-btn" onClick={onUpgrade}>
          업그레이드 →
        </button>
      )}
    </div>
  );
}
