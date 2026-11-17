/* Account Settings → Vaults → one vault, as a page inside the settings content
   area with a back link: the same shell as Vault Settings' member profile
   (`MemberProfilePage.tsx`). The Vaults tab hosts it and hands over its own
   actions (the card's ⋯ menu, the two-click delete, the missing-folder
   recovery), so nothing here re-implements a vault action. */
import type { ReactNode } from "react";
import type { BillingUsageVault } from "../lib/api";
import {
  orderPageActions,
  VAULT_SETTINGS_UNAVAILABLE_HINT,
  type VaultPageDetail,
  vaultPageTiles,
} from "../lib/accountVaultPage";
import { AsyncButton } from "./AsyncButton";
import type { RowAction } from "./RowActionsMenu";
import { VaultTile } from "./VaultSwitcher";

export function AccountVaultPage({
  orgId,
  name,
  slug,
  isCurrent,
  lapsed,
  busy,
  showStats,
  usage,
  usageLoading,
  details,
  actions,
  folderMissing,
  settingsAction,
  onSwitch,
  onOpenSettings,
  onBack,
}: {
  orgId: string;
  name: string;
  slug: string | null;
  isCurrent: boolean;
  lapsed: boolean;
  busy: boolean;
  /** False when the server does not report per-vault usage (billing off). */
  showStats: boolean;
  usage: BillingUsageVault | null;
  usageLoading: boolean;
  details: VaultPageDetail[];
  /** The card's ⋯ menu actions. */
  actions: RowAction[];
  /** Restore here / Locate folder… when the open vault's folder is gone. */
  folderMissing: ReactNode | null;
  settingsAction: "open" | "switch-then-open" | "unavailable";
  onSwitch: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
  /** Absent when the page sits beside the vault list (no Back needed). */
  onBack?: () => void;
}) {
  const tiles = vaultPageTiles(usage);
  const ordered = orderPageActions(actions);
  const switchChip = (
    <AsyncButton className="vault-switch-chip" disabled={busy} onClick={onSwitch}>
      여기로 전환
    </AsyncButton>
  );
  return (
    <section className="member-profile account-vault-page" aria-label={name}>
      {onBack && (
        <button type="button" className="link-btn member-profile-back" onClick={onBack}>
          ← 볼트
        </button>
      )}
      <header className="member-profile-head">
        <VaultTile identity={`org:${orgId}`} name={name} />
        <span className="member-profile-names">
          <span className="member-profile-name">{name}</span>
          {slug && <span className="muted">{slug}</span>}
        </span>
        <span className="account-vault-page-pills">
          {lapsed && <span className="billing-status canceled">읽기 전용</span>}
          {isCurrent ? (folderMissing ? null : <span className="member-role">현재</span>) : switchChip}
        </span>
      </header>

      {showStats && (
        <>
          <div className="subhead">통계</div>
          <div className="vault-usage-tiles">
            {tiles.map((t) => (
              <div key={t.key} className="vault-usage-tile">
                <span className="vault-usage-caption">{t.caption}</span>
                {usageLoading ? (
                  <span className="skel-line account-vault-page-skel" aria-hidden="true" />
                ) : (
                  <span className="vault-usage-value">{t.value ?? "—"}</span>
                )}
                <span className="vault-usage-sub" title={t.sub}>{t.sub}</span>
              </div>
            ))}
          </div>
          {!usageLoading && !usage && (
            <p className="muted account-vault-page-note">사용량은 내 계정의 볼트에만 표시돼요.</p>
          )}
        </>
      )}

      <div className="subhead">상세 정보</div>
      <dl className="member-profile-about">
        {details.map((d) => (
          <DetailRow key={d.key} label={d.label} value={d.value} />
        ))}
      </dl>

      <div className="subhead">작업</div>
      <ul className="account-vault-actions">
        {!isCurrent && (
          <ActionRow title="여기로 전환" description="이 볼트를 사이드바에서 열어요.">
            {switchChip}
          </ActionRow>
        )}
        {folderMissing && (
          <ActionRow title="폴더를 찾을 수 없음" description="이 기기에서 이 볼트의 폴더가 사라졌어요.">
            {folderMissing}
          </ActionRow>
        )}
        <ActionRow
          title="볼트 설정 열기"
          description={
            settingsAction === "unavailable"
              ? VAULT_SETTINGS_UNAVAILABLE_HINT
              : "멤버와 권한, 화면 설정 등을 바꿀 수 있어요."
          }
        >
          <AsyncButton
            className="ghost-pill sm"
            disabled={busy || settingsAction === "unavailable"}
            title={settingsAction === "unavailable" ? VAULT_SETTINGS_UNAVAILABLE_HINT : undefined}
            onClick={onOpenSettings}
          >
            열기
          </AsyncButton>
        </ActionRow>
        {ordered.map((a) => (
          <ActionRow key={a.key} title={a.label} description={a.title ?? ""} danger={a.danger}>
            <AsyncButton
              className={a.danger ? "link-btn danger" : "ghost-pill sm"}
              disabled={busy}
              onClick={async () => { await a.onSelect(); }}
            >
              {a.label}
            </AsyncButton>
          </ActionRow>
        ))}
      </ul>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </>
  );
}

function ActionRow({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`account-vault-action${danger ? " danger" : ""}`}>
      <span className="account-vault-action-copy">
        <span className="account-vault-action-title">{title}</span>
        {description && <span className="muted">{description}</span>}
      </span>
      <span className="account-vault-action-control">{children}</span>
    </li>
  );
}
