import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingConfig, BillingUsage, MyBillingAccount } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import {
  classifyBillingConfigResult,
  type BillingConfigState,
  billingErrorMessage,
  discountLine,
  formatBytes,
  formatMoney,
  invitedVaultAction,
  invitedVaultFallbackToast,
  type InvitedVault,
  isLegacyPlan,
  LAPSED_COPY,
  legacyPlanLine,
  peopleTableCopy,
  PLAN_LOAD_ERROR_COPY,
  planStatusPill,
  planPriceLine,
  seatUsageLines,
  SELF_HOSTED_PLAN_COPY,
} from "../lib/billing";
import * as ipc from "../lib/ipc";
import { toast } from "../lib/toast";
import { readOrgVaults, useStore } from "../store";
import { AsyncButton } from "./AsyncButton";
import { AccountPeopleGrid } from "./AccountPeopleGrid";
import { ConfirmDialog } from "./ConfirmDialog";
import { ManageSeatsDialog } from "./ManageSeatsDialog";
import { PlanHeader } from "./PlanHeader";
import { SeatUsageBreakdown } from "./SeatUsageBreakdown";
import { UpgradeDialog } from "./UpgradeDialog";
import "./editor.css";

/** Compact absolute date, same shape as the vault Billing tab's. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

type Loaded = {
  state: Exclude<BillingConfigState, "error">;
  config: BillingConfig;
  account: MyBillingAccount | null;
  usage: BillingUsage | null;
};

/** How long the tab waits before its one automatic retry of a failed fetch. */
const RETRY_DELAY_MS = 2000;

/** A request's value, or null when it failed — for the self-hosted page, which
 *  shows what answers and never an error. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/**
 * Account Settings → Plan & Billing (Team model). One billing account per owner:
 * one plan card (name, pill, price line, actions; seat breakdown on Team), the
 * account's usage as tiles, and the people on the account as a table. Usage is per vault and lives in Vault Settings → Usage. Old
 * servers (`model !== "team"`) bill per vault, so this tab only points at each
 * vault's own Billing tab there.
 */
export function AccountPlanTab() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [managingSeats, setManagingSeats] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One attempt. Throws on anything that is not a definitive answer. */
  const fetchOnce = useCallback(async (refresh = false): Promise<Loaded> => {
    let config: BillingConfig;
    let state: BillingConfigState;
    try {
      config = await authManager.api.probeBillingConfig();
      state = classifyBillingConfigResult(config);
    } catch (e) {
      state = classifyBillingConfigResult(e);
      if (state !== "disabled") throw e;
      config = { enabled: false };
    }
    if (state === "error") throw new Error("unclassifiable billing config");
    if (state === "disabled") {
      // Billing off (self-hosted without a provider): the account routes may
      // 404 too. Show whatever answers; never an error for this case.
      const [account, usage] = await Promise.all([
        orNull(authManager.api.getBillingAccount({ refresh })),
        orNull(authManager.api.getBillingUsage()),
      ]);
      return { state, config, account, usage };
    }
    if (state === "vault") return { state, config, account: null, usage: null };
    const [account, usage] = await Promise.all([
      authManager.api.getBillingAccount({ refresh }),
      authManager.api.getBillingUsage(),
    ]);
    return { state, config, account, usage };
  }, []);

  /** A failed fetch is never a verdict: retry once after 2 s, then show the
   *  error with Try again. */
  const load = useCallback(async (opts: { refresh?: boolean } = {}) => {
    setError(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const loaded = await fetchOnce(opts.refresh === true);
        if (mounted.current) setData(loaded);
        return;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    if (mounted.current) setError(PLAN_LOAD_ERROR_COPY);
  }, [fetchOnce]);

  const organizations = useStore((s) => s.organizations);

  // The mount load asks the server to re-read the live subscription once;
  // reloads after an action read the stored account.
  useEffect(() => {
    void load({ refresh: true });
  }, [load]);

  if (error) {
    return (
      <>
        <div className="auth-error">{error}</div>
        <AsyncButton className="secondary" onClick={load}>
          다시 시도
        </AsyncButton>
      </>
    );
  }
  if (!data) return <PlanSkeleton />;

  const { config, account, usage } = data;
  if (data.state === "disabled") {
    return (
      <SelfHostedPlan account={account} usage={usage} fallbackVaults={organizations.length} />
    );
  }
  if (data.state === "vault" || !account) {
    return (
      <div className="muted perm-empty">
        이 서버는 볼트별로 결제해요. 각 볼트 설정에서 관리하세요.
      </div>
    );
  }

  const ownsVaults = account.vaults.length > 0;
  const isTeam = account.plan === "team";
  const statusPill = planStatusPill(account, formatDate);
  const discount = discountLine({ ...account, currency: config.team?.currency ?? "usd" });

  // The store's billing mirror and locks feed Vault Settings and the lapse
  // padlocks; a plan change here must reach them too, not only this tab.
  const refreshShared = () => {
    const st = useStore.getState();
    void st.refreshMyBilling();
    void st.refreshOrgBilling();
    void st.refreshLocks();
  };

  // A vault in the Invited popover opens that vault's Vault Settings → Members and
  // access (the two settings dialogs are exclusive, so this closes Account
  // Settings). Another vault is switched to first; one with no folder on this
  // device cannot be, so the Vaults tab is the way in.
  const openInvitedVault = async (v: InvitedVault) => {
    const st = useStore.getState();
    const action = invitedVaultAction({
      orgId: v.orgId,
      activeOrgId: st.session?.activeOrganizationId ?? null,
      openPath: st.vault?.path ?? null,
      boundPath: readOrgVaults()[v.orgId] ?? null,
    });
    if (action === "vaults-tab") {
      st.requestAccountSettings("vaults");
      toast(invitedVaultFallbackToast(v.name), "neutral");
      return;
    }
    if (action === "switch-then-members") {
      try {
        await st.setActiveOrganization(v.orgId);
      } catch {
        // The switch reports its own failure; stay where we are.
      }
      if (useStore.getState().session?.activeOrganizationId !== v.orgId) return;
    }
    useStore.getState().requestSettings("members");
  };

  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setActionError(null);
    try {
      await fn();
      toast(done);
      await load();
      refreshShared();
      return true;
    } catch (e) {
      const message = billingErrorMessage(e);
      setActionError(message);
      toast(message, "error");
      return false;
    }
  };

  const openPortal = async () => {
    setActionError(null);
    try {
      const { url } = await authManager.api.accountPortalUrl();
      await ipc.openExternal(url);
    } catch (e) {
      setActionError(billingErrorMessage(e));
    }
  };

  // ---- Header line under the plan name ----
  const seatsBought = account.seats.purchased;
  const legacy = isTeam && isLegacyPlan(account);
  const peopleCopy = peopleTableCopy({ ...account, legacyPlan: legacy });
  const summary = legacy
    ? legacyPlanLine(account, config.team?.currency ?? "usd", formatDate)
    : isTeam
    ? [
        planPriceLine(account.plan, account.interval, config.team),
        seatsBought != null ? `좌석 ${seatsBought}개` : null,
        account.currentPeriodEnd
          ? `${formatDate(account.currentPeriodEnd)} ${account.cancelAtPeriodEnd ? "해지 예정" : "갱신"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "나와 팀원 1명 · $0";

  // ---- Usage tiles: meters against the Free ceilings, plain counts on Team ----
  const syncedVaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : 0;
  const vaultLimit = isTeam ? null : (usage?.limits.vaults ?? account.limits.vaults);
  const peopleLimit = isTeam ? null : (usage?.limits.people ?? account.limits.people);
  const freeBase = config.free?.syncedVaults ?? null;
  const [bytesValue, bytesUnit] = formatBytes(usage?.totals.storageBytes ?? 0).split(" ");
  const tiles: {
    key: string;
    caption: string;
    value: string;
    sub: string;
    meter: { used: number; limit: number } | null;
  }[] = usage
    ? [
        {
          key: "vaults",
          caption: "동기화 볼트",
          value: String(syncedVaults),
          sub:
            vaultLimit != null
              ? freeBase != null && vaultLimit > freeBase
                ? `${vaultLimit}개 중 · 이전에 쓰던 볼트 포함`
                : `${vaultLimit}개 중`
              : "개",
          meter: vaultLimit != null ? { used: syncedVaults, limit: vaultLimit } : null,
        },
        {
          key: "people",
          caption: "인원",
          value: String(usage.totals.people),
          sub:
            peopleLimit != null
              ? `이 계정에서 ${peopleLimit}명 중`
              : "명",
          meter: peopleLimit != null ? { used: usage.totals.people, limit: peopleLimit } : null,
        },
        {
          key: "notes",
          caption: "노트",
          value: String(usage.totals.notes),
          sub: "내 모든 볼트 합계",
          meter: null,
        },
        {
          key: "attachments",
          caption: "첨부 파일",
          value: bytesValue ?? "0",
          sub: bytesUnit ?? "B",
          meter: null,
        },
      ]
    : [];

  // ---- Team with seats bought: plan card + seats card side by side ----
  const twoCards = isTeam && !legacy && seatsBought != null;
  const iv = account.interval ?? "month";
  const perSeat = config.team?.prices.find((p) => p.interval === iv)?.perSeat ?? null;
  const currency = config.team?.currency ?? "usd";
  const total = perSeat != null && seatsBought != null ? formatMoney(perSeat * seatsBought, currency) : null;
  const totalSub = [
    perSeat != null && seatsBought != null
      ? `좌석 ${seatsBought}개 × ${formatMoney(perSeat, currency)}`
      : null,
    account.currentPeriodEnd
      ? `${formatDate(account.currentPeriodEnd)} ${account.cancelAtPeriodEnd ? "해지 예정" : "갱신"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const cancelOrResume =
    account.cancelAtPeriodEnd || account.lapsed ? (
      <AsyncButton
        className="secondary"
        onClick={() => run(() => authManager.api.accountResume(), "요금제를 재개했어요.")}
      >
        요금제 재개
      </AsyncButton>
    ) : (
      <AsyncButton
        type="button"
        className="link-btn plan-cancel"
        onClick={() => {
          setActionError(null);
          setConfirmCancel(true);
        }}
      >
        요금제 해지
      </AsyncButton>
    );

  return (
    <>
      {twoCards ? (
        <div className="plan-cards">
          <div className="billing-card plan-card">
            <div className="billing-plan-head">
              <span className="billing-plan-name">Team</span>
              {statusPill && <span className={`billing-status ${statusPill.tone}`}>{statusPill.label}</span>}
            </div>
            {total ? (
              <>
                <div className="plan-total">
                  {total}
                  <span> / {iv === "year" ? "연" : "월"}</span>
                </div>
                {totalSub && <div className="billing-section-note muted">{totalSub}</div>}
              </>
            ) : (
              <div className="billing-section-note">{summary}</div>
            )}
            {discount && <div className="plan-discount">{discount}</div>}
            {account.lapsed && <div className="auth-error">{LAPSED_COPY}</div>}
            <div className="plan-card-spacer" />
            {account.canManage ? (
              <div className="plan-card-actions">
                <AsyncButton className="secondary" onClick={openPortal}>
                  결제 관리
                </AsyncButton>
                {cancelOrResume}
              </div>
            ) : (
              <div className="billing-section-note">
                {ownsVaults
                  ? "결제는 볼트 소유자가 관리해요."
                  : "소유한 볼트가 없어요. 결제는 각 볼트의 소유자가 관리해요."}
              </div>
            )}
          </div>
          <div className="billing-card seats-card">
            <div className="seats-card-head">
              <span className="seats-card-title">좌석</span>
              {account.canManage && (
                <AsyncButton className="plan-ink-btn" onClick={() => setManagingSeats(true)}>
                  좌석 추가
                </AsyncButton>
              )}
            </div>
            <SeatUsageBreakdown
              layout="ring"
              seats={account.seats}
              canManage={account.canManage}
              showManage={false}
              onManage={() => setManagingSeats(true)}
              invitedByVault={account.invitedByVault}
              onOpenInvitedVault={(v) => void openInvitedVault(v)}
            />
          </div>
        </div>
      ) : (
      <div className={`billing-card${isTeam ? " plan-pro" : ""}`}>
        <div className="plan-page-head">
          <div className="plan-page-summary">
            <PlanHeader name={isTeam ? "Team" : "Free"} pill={statusPill} />
            <div className="billing-section-note">{summary}</div>
            {discount && <div className="billing-section-note muted">{discount}</div>}
            {account.complimentaryUntil && (
              <div className="billing-section-note">
                Team 무료 제공 · {formatDate(account.complimentaryUntil)}까지
              </div>
            )}
          </div>
          {account.canManage && (
            <div className="plan-page-actions">
              {!isTeam ? (
                <button className="primary" onClick={() => setUpgrading(true)}>
                  Team으로 업그레이드
                </button>
              ) : (
                <>
                  <AsyncButton className="secondary" onClick={openPortal}>
                    결제 관리
                  </AsyncButton>
                  {account.cancelAtPeriodEnd || account.lapsed ? (
                    <AsyncButton
                      className="secondary"
                      onClick={() => run(() => authManager.api.accountResume(), "요금제를 재개했어요.")}
                    >
                      요금제 재개
                    </AsyncButton>
                  ) : (
                    <AsyncButton
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setActionError(null);
                        setConfirmCancel(true);
                      }}
                    >
                      요금제 해지
                    </AsyncButton>
                  )}
                  {!legacy && (
                    <AsyncButton className="primary" onClick={() => setManagingSeats(true)}>
                      좌석 추가·변경
                    </AsyncButton>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {isTeam &&
          (account.seats.purchased != null ? (
            <SeatUsageBreakdown
              seats={account.seats}
              canManage={account.canManage}
              showManage={false}
              onManage={() => setManagingSeats(true)}
              invitedByVault={account.invitedByVault}
              onOpenInvitedVault={(v) => void openInvitedVault(v)}
            />
          ) : (
            seatUsageLines(account.seats, formatDate).map((line) => (
              <div key={line} className="billing-section-note">
                {line}
              </div>
            ))
          ))}
        {account.lapsed && <div className="auth-error">{LAPSED_COPY}</div>}
        {!account.canManage && (
          <div className="billing-section-note">
            {ownsVaults
              ? "결제는 볼트 소유자가 관리해요."
              : "소유한 볼트가 없어요. 결제는 각 볼트의 소유자가 관리해요."}
          </div>
        )}
      </div>
      )}
      {actionError && !confirmCancel && <div className="auth-error">{actionError}</div>}

      {/* ---- Usage on this account ---- */}
      {ownsVaults && tiles.length > 0 && (
        <>
          <div className="subhead">이 계정의 사용량</div>
          <div className="vault-usage-tiles">
            {tiles.map((t) => {
              const full = !!t.meter && t.meter.limit > 0 && t.meter.used >= t.meter.limit;
              const pct =
                t.meter && t.meter.limit > 0
                  ? Math.min(100, Math.round((t.meter.used / t.meter.limit) * 100))
                  : 0;
              return (
                <div key={t.key} className="vault-usage-tile">
                  <span className="vault-usage-caption">{t.caption}</span>
                  <span className="vault-usage-value">{t.value}</span>
                  <span className="vault-usage-sub" title={t.sub}>
                    {t.sub}
                  </span>
                  {t.meter && (
                    <div
                      className={`vault-usage-meter${full ? " is-full" : ""}`}
                      role="meter"
                      aria-label={t.caption}
                      aria-valuemin={0}
                      aria-valuemax={t.meter.limit}
                      aria-valuenow={t.meter.used}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---- People on this account (owners only) ---- */}
      {account.canManage && account.people.length > 0 && (
        <>
          <div className="subhead">이 계정의 인원</div>
          {peopleCopy.note && <div className="billing-section-note muted">{peopleCopy.note}</div>}
          <AccountPeopleGrid people={account.people} seatTag={!!peopleCopy.seatColumn} />
        </>
      )}

      {upgrading && (
        <UpgradeDialog
          onClose={() => {
            setUpgrading(false);
            void load();
          }}
        />
      )}
      {managingSeats && (
        <ManageSeatsDialog
          account={account}
          config={config}
          formatDate={formatDate}
          onClose={() => setManagingSeats(false)}
          onChanged={() => {
            void load();
            refreshShared();
          }}
          onResume={() => run(() => authManager.api.accountResume(), "요금제를 재개했어요.")}
          onKeepSeats={() =>
            run(
              () => authManager.api.setSeats(account.seats.purchased ?? 0),
              "좌석 변경을 취소했어요.",
            )
          }
        />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title="Team 요금제를 해지할까요?"
          confirmLabel="요금제 해지"
          cancelLabel="유지"
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async () => {
            const ok = await run(
              () => authManager.api.accountCancel(),
              "기간이 끝나면 요금제가 해지돼요.",
            );
            if (ok) setConfirmCancel(false);
          }}
        >
          <p>
            {account.currentPeriodEnd
              ? `${formatDate(account.currentPeriodEnd)}까지 Team이 유지돼요. 그 후에는 구독을 재개할 때까지 3명 이상이 있는 볼트의 동기화가 읽기 전용이 돼요.`
              : "현재 기간이 끝날 때까지 Team이 유지돼요. 그 후에는 구독을 재개할 때까지 3명 이상이 있는 볼트의 동기화가 읽기 전용이 돼요."}
          </p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * Plan & Billing on a server with billing off (self-hosted without a provider):
 * no plan to buy, so no Upgrade. Usage and people come from the account routes
 * when they answer; otherwise the vault count falls back to the account's
 * vault list and sections without data are left out.
 */
function SelfHostedPlan({
  account,
  usage,
  fallbackVaults,
}: {
  account: MyBillingAccount | null;
  usage: BillingUsage | null;
  fallbackVaults: number;
}) {
  const vaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : fallbackVaults;
  const tiles: { key: string; caption: string; value: string; sub: string }[] = [
    { key: "vaults", caption: "동기화 볼트", value: String(vaults), sub: "개" },
  ];
  if (usage) {
    const [bytesValue, bytesUnit] = formatBytes(usage.totals.storageBytes ?? 0).split(" ");
    tiles.push(
      {
        key: "people",
        caption: "인원",
        value: String(usage.totals.people),
        sub: "명",
      },
      { key: "notes", caption: "노트", value: String(usage.totals.notes), sub: "내 모든 볼트 합계" },
      { key: "attachments", caption: "첨부 파일", value: bytesValue ?? "0", sub: bytesUnit ?? "B" },
    );
  }
  const people = account?.canManage ? account.people : [];
  return (
    <>
      <div className="billing-card">
        <div className="plan-page-head">
          <div className="plan-page-summary">
            <div className="billing-plan-head">
              <span className="billing-plan-name">자체 호스팅</span>
              <span className="billing-status none">제한 없음</span>
            </div>
            <div className="billing-section-note">{SELF_HOSTED_PLAN_COPY}</div>
          </div>
        </div>
      </div>

      {(usage || vaults > 0) && (
        <>
          <div className="subhead">이 계정의 사용량</div>
          <div className="vault-usage-tiles">
            {tiles.map((t) => (
              <div key={t.key} className="vault-usage-tile">
                <span className="vault-usage-caption">{t.caption}</span>
                <span className="vault-usage-value">{t.value}</span>
                <span className="vault-usage-sub" title={t.sub}>
                  {t.sub}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {account && people.length > 0 && (
        <>
          <div className="subhead">이 계정의 인원</div>
          <AccountPeopleGrid people={people} />
        </>
      )}
    </>
  );
}

/** Plan & Billing while the account loads: the two cards' shapes, shimmering. */
function PlanSkeleton() {
  return (
    <div className="plan-cards plan-skeleton" aria-busy="true" aria-label="요금제 불러오는 중">
      <div className="billing-card plan-card">
        <span className="skel-line" style={{ width: 90, height: 11 }} />
        <span className="skel-line" style={{ width: 140, height: 28, marginTop: 14 }} />
        <span className="skel-line" style={{ width: "70%", height: 12, marginTop: 14 }} />
        <span className="skel-line" style={{ width: "55%", height: 12, marginTop: 8 }} />
        <span className="skel-line" style={{ width: 130, height: 34, marginTop: 24, borderRadius: 10 }} />
      </div>
      <div className="billing-card plan-card plan-skeleton-seats">
        <span className="plan-skeleton-ring" />
        <span className="plan-skeleton-legend">
          <span className="skel-line" style={{ width: 120, height: 12 }} />
          <span className="skel-line" style={{ width: 90, height: 12 }} />
          <span className="skel-line" style={{ width: 100, height: 12 }} />
        </span>
      </div>
    </div>
  );
}
