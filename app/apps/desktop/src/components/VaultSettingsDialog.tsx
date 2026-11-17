/* The vault-settings dialog and its nine tabs — the whole settings surface of
   the app, split out of `AccountMenu.tsx` so it can load on demand. Nothing
   here is on the first screen: the sidebar footer (identity bar + popovers)
   stays eager, and this chunk lands when someone actually opens settings. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type BillingUsage,
  type MyBillingAccount,
  type MyBillingVault,
  type UnsyncPreview,
  type VaultCheckpoint,
} from "../lib/api";
import { toast } from "../lib/toast";
import { noteCountLabel } from "./versionFormat";
import { RowActionsMenu } from "./RowActionsMenu";
import { authManager } from "../lib/auth/authManager";
import {
  classifyLimitError,
  formatBytes,
  LEGACY_PRO_BENEFITS,
  legacyFreePlanExplanation,
  type LimitKind,
  limitFromError,
  planPillLabel,
  subscriptionStatusLine,
  transferTargets,
  vaultPlanLine,
  vaultLimitReason,
} from "../lib/billing";
import * as ipc from "../lib/ipc";
import { requestTurnOnSyncAfterAuth, useStore } from "../store";
import { MembersAccessTab, prefetchRoster } from "./MembersAccessTab";
import { AsyncButton } from "./AsyncButton";
import { McpTab } from "./McpTab";
import { ConfirmDialog } from "./ConfirmDialog";
import { useResetLocalCopy } from "./useResetLocalCopy";
// Static, not via ./Face: this module is itself a lazy chunk, so it pays for
// the avatar chunk it is already loading.
import { LimitNudge } from "./LimitNudge";
import { MenuIcon } from "./MenuIcon";
import { SettingsModal } from "./SettingsModal";
import { SettingsCrossLink } from "./SettingsCrossLink";
import { Switch } from "./Switch";
import { ThemeToggle } from "./ThemeToggle";
import { AppearanceRows } from "./AppearanceRows";
import {
  APPEARANCE_DEFAULTS,
  vaultAppearanceValues,
  type AppearanceKey,
  type AppearanceSettings,
  type ResolvedAppearance,
} from "../lib/appearanceSettings";
import { formatPrice, perLabel, UpgradeDialog } from "./UpgradeDialog";
import { useLocalFolderClasses, useLocalVaults } from "./useVaultLists";
import { visibleFolders } from "../lib/vault/vaultList";
import { VaultIconSettings } from "./VaultIconSettings";
import { VaultDashboardsTab } from "./VaultDashboardsTab";
import { AccountVaultsTab } from "./AccountVaultsTab";
import { SkillsTab } from "./skills/SkillsTab";
import { VaultKeySection } from "./VaultKeySection";
import { SaveVaultKeyCard } from "./SaveVaultKeyCard";
import { syncManager } from "../lib/sync/docSession";
import { AGENT_SKILLS_ICON_PATH } from "./skills/parts";

// Defined in `lib/settingsTabs.ts` so the store can name a tab without importing
// this component; re-exported here so every existing importer is unchanged.
export type { SettingsTab } from "../lib/settingsTabs";
import type { SettingsTab } from "../lib/settingsTabs";
import { PlanHeader } from "./PlanHeader";

// Sections that only make sense once the vault is synced to an org. On a
// local vault they're shown but locked, with a "Turn on sync" gate.
//
// Billing is deliberately NOT one of them (#109). Someone working in a local
// folder can still own vaults that are billing, and a subscription left behind
// by a DELETED vault has to be reachable from somewhere or the money is
// unrecoverable. Only the per-vault card at the top of that tab needs a synced
// vault, and it says so itself.
const TEAM_TABS = new Set<SettingsTab>([
  "members",
  "mcp",
  "skills",
  "versioning",
]);

/** General tab: name, folder, and sync state (incl. the Turn-on-sync CTA). */
const GENERAL_TAB: { id: SettingsTab; label: string; icon: React.ReactNode } = {
  id: "general",
  label: "일반",
  icon: (
    <MenuIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </MenuIcon>
  ),
};

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  {
    id: "vaults",
    label: "볼트",
    icon: (
      <MenuIcon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </MenuIcon>
    ),
  },
  {
    id: "members",
    label: "멤버 및 권한",
    icon: (
      <MenuIcon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </MenuIcon>
    ),
  },
  { id: "dashboards", label: "대시보드", icon: <MenuIcon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></MenuIcon> },
  {
    id: "mcp",
    label: "MCP",
    icon: (
      <MenuIcon>
        <path d="M4 17l6-6-6-6" />
        <path d="M12 19h8" />
      </MenuIcon>
    ),
  },
  {
    id: "skills",
    label: "에이전트 스킬",
    icon: (
      <MenuIcon>
        <path d={AGENT_SKILLS_ICON_PATH} />
      </MenuIcon>
    ),
  },
  {
    id: "versioning",
    label: "버전 관리",
    icon: (
      <MenuIcon>
        <path d="M3 12a9 9 0 1 0 2.6-6.4" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </MenuIcon>
    ),
  },
  {
    id: "import-export",
    label: "가져오기 / 내보내기",
    icon: (
      <MenuIcon>
        <path d="M12 3v10" />
        <path d="m8 9 4 4 4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </MenuIcon>
    ),
  },
  {
    id: "appearance",
    label: "화면",
    icon: (
      <MenuIcon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10" />
      </MenuIcon>
    ),
  },
];

/** The Billing tab, inserted after Members only when the server has billing on. */
const BILLING_TAB: { id: SettingsTab; label: string; icon: React.ReactNode } = {
  id: "billing",
  label: "결제",
  icon: (
    <MenuIcon>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </MenuIcon>
  ),
};

/**
 * Vault settings — a centered modal over the app (sharing its shell with
 * Account settings via {@link SettingsModal}): everything about the vault lives
 * here. Members (roster + join code + invites), Permissions (RBAC locks), and
 * Appearance (the vault's appearance defaults).
 */
/** Redesign preview: plain-word names for a few tabs. */
const RD_LABEL: Partial<Record<string, string>> = {
  members: "사람 및 권한",
  versioning: "버전 기록",
  "import-export": "가져오기 및 내보내기",
  mcp: "MCP",
};
const rdLabel = (t: { id: string; label: string }) => RD_LABEL[t.id] ?? t.label;

export function VaultSettingsDialog({
  onClose,
  onRequestSignIn,
  initialTab,
  initialSection,
}: {
  onClose: () => void;
  onRequestSignIn?: () => void;
  initialTab?: SettingsTab;
  /** A `[data-settings-section]` in the opening tab to scroll to and highlight. */
  initialSection?: string;
}) {
  const session = useStore((s) => s.session);
  const organizations = useStore((s) => s.organizations);
  const members = useStore((s) => s.members);
  const billingConfig = useStore((s) => s.billingConfig);
  const vault = useStore((s) => s.vault);
  const syncEnabled = useStore((s) => s.syncEnabled);
  const locals = useLocalVaults();

  const visibleTab = (t: SettingsTab): SettingsTab =>
    t === "vaults" && session ? "general" : t;
  const [tab, setTabRaw] = useState<SettingsTab>(visibleTab(initialTab ?? "general"));
  /** Bumped when the active nav item is clicked again, so a tab can return to its first page. */
  const [tabReset, setTabReset] = useState(0);
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab, tabReset]);
  useEffect(() => {
    // The section can render a beat after the tab (it loads its own state), so
    // look for it for up to 3 s, once per opening.
    if (!initialSection) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        `[data-settings-section="${CSS.escape(initialSection)}"]`,
      );
      if (!el && ++tries < 30) return;
      window.clearInterval(timer);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("settings-section-flash");
      window.setTimeout(() => el.classList.remove("settings-section-flash"), 1400);
    }, 100);
    return () => window.clearInterval(timer);
  }, [initialSection]);
  const setTab = (t: SettingsTab) => setTabRaw(visibleTab(t));

  // Esc, click-away, focus and the backdrop all live in `SettingsModal`.
  const activeOrg =
    organizations.find((o) => o.id === session?.activeOrganizationId) ?? null;
  // Is the vault we're looking at actually syncing to an org? A local
  // vault (signed out, or an unsynced local folder) shows a reduced page
  // with the team sections locked behind "Turn on sync".
  const isSynced = syncEnabled && !!activeOrg;
  const billingEnabled = billingConfig?.enabled === true;
  // Team model: the plan lives on the account (Account Settings → Plan &
  // Billing), so this vault's page shows its usage. Same tab id, so a
  // `requestSettings("billing")` deep link still lands here.
  const teamBilling = billingConfig?.model === "team";

  // The vault list lives in Account Settings → Vaults (2026-10-07). Only a
  // signed-out app with local folders keeps it here: it has no account page.
  // Signed out every stamped folder is hidden there (`visibleFolders`), so the
  // tab appears only when an unstamped local folder remains to list.
  const localClasses = useLocalFolderClasses(session ? [] : locals, []);
  const showVaults =
    !session &&
    localClasses.resolved &&
    visibleFolders(locals, localClasses.classes).length > 0;
  const tabs = useMemo(() => {
    const out = [GENERAL_TAB];
    if (showVaults) out.push(...SETTINGS_TABS);
    else out.push(...SETTINGS_TABS.filter((t) => t.id !== "vaults"));
    if (billingEnabled) {
      const idx = out.findIndex((t) => t.id === "dashboards");
      out.splice(
        idx >= 0 ? idx + 1 : out.length,
        0,
        teamBilling ? { ...BILLING_TAB, label: "사용량" } : BILLING_TAB,
      );
    }
    return out;
  }, [showVaults, billingEnabled, teamBilling]);

  // Warm the Members tab's roster as the dialog opens (#307); paint only.
  useEffect(() => {
    const orgId = session?.activeOrganizationId ?? null;
    const me = members.find((m) => m.userId === session?.user.id);
    if (!orgId || !me) return;
    prefetchRoster(orgId, me.role === "owner" || me.role === "admin");
  }, [session, members]);

  if (!session && !vault) return null;
  const myMember = members.find((m) => m.userId === session?.user.id);
  const canManage = myMember?.role === "owner" || myMember?.role === "admin";
  // Stricter than `canManage`: making a vault local only destroys the server
  // copy for everyone, so an admin may not do it (the server agrees — 403
  // `owner_only`) and the control simply isn't drawn for them.
  const isOwner = myMember?.role === "owner";
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const lockedTab = TEAM_TABS.has(activeTab.id) && !isSynced;
  // Render what the nav shows: a requested tab that is not offered yet (the
  // signed-out Vaults list before the recents load) paints the first tab.
  const shown = activeTab.id;

  return (
    <SettingsModal
      label={isSynced ? "볼트 설정" : "로컬 볼트 설정"}
      onClose={onClose}
    >
      <header className="settings-page-header">
        <div className="settings-title">
          <span className="settings-eyebrow">
            {isSynced ? "볼트 설정" : "로컬 볼트"}
          </span>
          {/* The session's active org outlives a switch to a local folder, so
              its name only titles the dialog while that vault is the synced one. */}
          <h1>{(isSynced ? activeOrg?.name : null) ?? vault?.name ?? "볼트"}</h1>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="설정 닫기" title="닫기 (Esc)">
          ✕
        </button>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="설정 섹션">
          {tabs.map((t) => {
            const locked = TEAM_TABS.has(t.id) && !isSynced;
            return (
              <button
                key={t.id}
                type="button"
                className={`menu-item${tab === t.id ? " active" : ""}${locked ? " locked" : ""}`}
                onClick={() => {
                  // Re-clicking the active item resets its sub-pages (#308).
                  if (tab === t.id) setTabReset((n) => n + 1);
                  else setTab(t.id);
                }}
                title={locked ? "동기화를 켜면 사용할 수 있어요" : undefined}
              >
                {t.icon}
                <span className="menu-item-label">{rdLabel(t)}</span>
                {locked && (
                  <svg
                    className="nav-lock"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
              </button>
            );
          })}
          {session && (
            <SettingsCrossLink
              label="계정 설정"
              onOpen={() => useStore.getState().requestAccountSettings("profile")}
            />
          )}
        </nav>

        <section key={shown} ref={contentRef} className="settings-content rd-tab-in" aria-label={activeTab.label}>
          {/* Members and access (and Skills) swap the title for a back link
              while a profile (or a skill) is open. */}
          {!((shown === "members" || shown === "skills") && !lockedTab) && <h2 className="settings-section-title">{rdLabel(activeTab)}</h2>}
          {shown === "general" ? (
            <GeneralTab
              isSynced={isSynced}
              canManage={canManage}
              isOwner={isOwner}
              activeOrgName={activeOrg?.name ?? null}
              onRequestSignIn={onRequestSignIn}
            />
          ) : shown === "dashboards" ? (
            <VaultDashboardsTab onClose={onClose} resetToken={tabReset} />
          ) : lockedTab ? (
            <SyncGate label={activeTab.label} onRequestSignIn={onRequestSignIn} />
          ) : shown === "vaults" ? (
            <AccountVaultsTab />
          ) : shown === "members" ? (
            <MembersAccessTab
              canManage={canManage}
              onOpenTab={setTab}
              onCloseSettings={onClose}
              resetToken={tabReset}
            />
          ) : shown === "billing" ? (
            <BillingTab canManage={canManage} isSynced={isSynced} />
          ) : shown === "mcp" ? (
            <McpTab />
          ) : shown === "skills" ? (
            <SkillsTab canManage={canManage} resetToken={tabReset} />
          ) : shown === "versioning" ? (
            <VersioningTab canManage={canManage} />
          ) : shown === "import-export" ? (
            <ImportExportTab />
          ) : (
            <AppearanceTab canManage={canManage} isSynced={isSynced} />
          )}
        </section>
      </div>
    </SettingsModal>
  );
}

/**
 * General tab: the identity of the current vault. Its heart is the
 * Turn-on-sync card for a local vault — which adopts the folder you're
 * already in (files and all) rather than making you set up a new one.
 */
function GeneralTab({
  isSynced,
  canManage,
  isOwner,
  activeOrgName,
  onRequestSignIn,
}: {
  isSynced: boolean;
  /** Owner/admin — the only roles that may flip a vault-wide latch. */
  canManage: boolean;
  /** Owner alone — the only role that may destroy the server copy. */
  isOwner: boolean;
  activeOrgName: string | null;
  onRequestSignIn?: () => void;
}) {
  const vault = useStore((s) => s.vault);
  const authStatus = useStore((s) => s.authStatus);
  // The sidebar paints before the session restore finishes, so this page can be
  // open while we still don't know whether anyone is signed in.
  const authPending = authStatus === "unknown";
  const activeOrgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  // Same identity the sidebar switcher keys its icons on.
  const iconIdentity =
    isSynced && activeOrgId ? `org:${activeOrgId}` : vault ? `local:${vault.path}` : null;

  const [name, setName] = useState(vault?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNudge, setLimitNudge] = useState<{ kind: LimitKind; limit: number | null } | null>(
    null,
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const turnOn = async () => {
    if (authStatus !== "signed-in") {
      // Not signed in yet — launch sign-in right here instead of dead-ending.
      // After sign-in the button becomes "Turn on sync" (the page stays open).
      onRequestSignIn?.();
      return;
    }
    setBusy(true);
    setError(null);
    setLimitNudge(null);
    try {
      await useStore.getState().turnOnSyncForCurrentVault(name.trim() || undefined);
    } catch (e) {
      const kind = classifyLimitError(e);
      if (kind) {
        const limit = limitFromError(e);
        setLimitNudge({ kind, limit });
        // Team model: the refusal IS the upgrade moment, so the plan comparison
        // opens at once; the nudge stays behind it for after a close.
        const st = useStore.getState();
        if (kind === "vault_limit" && st.billingConfig?.model === "team") {
          st.requestUpgradeDialog({
            reason: vaultLimitReason(limit ?? st.billingConfig.freeLimits?.vaultsPerUser ?? 1),
          });
        }
      } else {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        // The inline line can be scrolled out of view, and the button simply
        // returns to idle — which reads as "nothing happened". A sticky toast is
        // always visible (#85).
        toast(`동기화를 켜지 못했어요: ${message}`, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Only an owner with no other way back sees it; it renders nothing otherwise. */}
      {isSynced && isOwner && syncManager.registry.vaultId && (
        <SaveVaultKeyCard vaultId={syncManager.registry.vaultId} vaultName={activeOrgName ?? "볼트"} />
      )}
      {iconIdentity && (
        <>
          {/* One icon per vault. A synced vault's belongs to the org: members see
              the owner's picker with every action disabled. */}
          <VaultIconSettings
            identity={iconIdentity}
            name={(isSynced ? activeOrgName : null) ?? vault?.name ?? ""}
            canEdit={!isSynced || canManage}
          />
          {/* A synced vault's next row (Freeze vault root) brings its own divider. */}
          {!isSynced && <div className="menu-sep" />}
        </>
      )}
      {!isSynced && (
        <>
          <div className="muted">
            {activeOrgName
              ? "로컬 폴더를 보고 있어요. 동기화를 켜면 이 볼트를 내 계정에 보관하고 여러 기기에서 쓸 수 있어요."
              : "이 볼트는 이 컴퓨터에만 있어요. 동기화를 켜면 다른 기기에서도 쓰고 사람을 초대할 수 있어요."}
          </div>

          <div className="sync-promo">
            <h3 className="sync-promo-title">동기화 및 공유 켜기</h3>
            <p className="sync-promo-desc">
              이미 있는 노트와 폴더는 그대로 유지돼서 다시 가져올 필요가 없어요.
              실시간 협업을 켜고 사람을 초대할 수 있어요. 기본적으로 볼트의 모든 멤버가
              편집할 수 있고, 누가 무엇을 볼지는 직접 정해요.
            </p>
            <div className="row invite-bar">
              <input
                placeholder="볼트 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void turnOn();
                }}
              />
              {/* Disabled while the session restore runs: its answer decides
                  whether this button turns sync on or raises a sign-in card,
                  and pressing it in between would do the wrong one. */}
              <button
                className="primary"
                disabled={busy || authPending}
                onClick={() => void turnOn()}
              >
                {busy
                  ? "…"
                  : authPending
                    ? "계정을 확인하는 중…"
                    : authStatus === "signed-in"
                      ? "동기화 켜기"
                      : "로그인하고 켜기"}
              </button>
            </div>
            {!authPending && authStatus !== "signed-in" && (
              <div className="muted">먼저 로그인해야 해요. 이 버튼을 누르면 안내해 드려요.</div>
            )}
            {error && <div className="auth-error">{error}</div>}
            {limitNudge && (
              <LimitNudge
                kind={limitNudge.kind}
                limit={limitNudge.limit}
                onUpgrade={() => setUpgradeOpen(true)}
              />
            )}
          </div>
        </>
      )}

      {isSynced && canManage && <FreezeRootRow canManage={canManage} />}

      <div className="menu-sep" />
      <div className="subhead">디스크의 폴더</div>
      <div className="join-code-row">
        <code className="vault-root-path" title={vault?.path ?? ""}>
          {vault?.path ?? "—"}
        </code>
      </div>

      {isSynced && isOwner && <UnsyncDangerZone />}

      {/* Security sits last; the card brings its own heading, so nothing shows
          for a vault that is not encrypted. */}
      {isSynced && canManage && (
        <VaultKeySection vaultName={activeOrgName ?? "볼트"} isOwner={isOwner} canManage={canManage} />
      )}

      {upgradeOpen && <UpgradeDialog onClose={() => setUpgradeOpen(false)} />}
    </>
  );
}

/**
 * The mirror of "Turn on sync": take the vault back off the server and keep the
 * folder. Owner-only, at the bottom of the page, behind a type-the-name confirm
 * — the three things that stop a mis-click on the one action in this dialog that
 * destroys other people's access.
 *
 * The counts come from the preview call rather than from anything this device
 * knows: what matters is what the SERVER is about to lose (edit history, version
 * checkpoints, public links, MCP tokens), none of which the local index can see.
 */
function UnsyncDangerZone() {
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const orgName = useStore(
    (s) =>
      s.organizations.find((o) => o.id === s.session?.activeOrganizationId)?.name ?? null,
  );
  const vaultPath = useStore((s) => s.vault?.path ?? null);
  const serverUrl = useStore((s) => s.serverUrl);
  const [preview, setPreview] = useState<UnsyncPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reset = useResetLocalCopy();

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    authManager.api
      .getUnsyncPreview(orgId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      // A preview that won't load must not hide the control: the confirm asks
      // again, and the server is the gate either way.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!orgId || !orgName) return null;
  const folder = vaultPath ? (vaultPath.split("/").pop() ?? vaultPath) : null;

  return (
    <>
      <div className="menu-sep" />
      <div className="subhead">위험 영역</div>
      {reset.available && (
        <div className="vault-local-only-card">
          <span className="vault-local-only-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </span>
          <div className="vault-local-only-copy">
            <strong>로컬 사본 초기화</strong>
            <span className="field-hint">
              이 기기의 {folder ? <><strong>{folder}</strong> 폴더</> : "이 볼트의 폴더"}를 삭제하고
              {serverHost(serverUrl)}에서 새 사본을 내려받아요. 팀에는 아무 변화가 없어요.
            </span>
          </div>
          <button className="vault-local-only-action" onClick={reset.start}>
            초기화
          </button>
        </div>
      )}
      <div className="vault-local-only-card">
        <span className="vault-local-only-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 2.5 20h19L12 3Z" />
            <path d="M12 9v5M12 17h.01" />
          </svg>
        </span>
        <div className="vault-local-only-copy">
          <strong>이 볼트를 로컬 전용으로 바꾸기</strong>
          <span className="field-hint">
            {folder ? (
              <>
                이 기기의 <strong>{folder}</strong> 폴더는 유지하고 {serverHost(serverUrl)}의
                동기화 사본을 삭제해요.
              </>
            ) : (
              <>이 기기의 로컬 폴더는 유지하고 {serverHost(serverUrl)}의 동기화 사본을 삭제해요.</>
            )}{" "}
            {preview ? (
              <>
                노트 {preview.notes}개와 파일 {preview.files}개의 서버 사본, 버전 기록, 공유 설정이
                삭제돼요.{" "}
                {preview.members > 0
                  ? `팀원 ${preview.members}명이 접근 권한을 잃어요.`
                  : "현재 접근 권한이 있는 팀원은 없어요."}
              </>
            ) : (
              "삭제될 항목을 확인하는 중…"
            )}
          </span>
        </div>
        <button className="vault-local-only-action" onClick={() => setConfirming(true)}>
          로컬 전용으로 바꾸기
        </button>
      </div>
      {reset.dialog}
      {confirming && (
        <UnsyncConfirmDialog
          orgId={orgId}
          orgName={orgName}
          folderName={folder}
          seed={preview}
          onCancel={() => setConfirming(false)}
          onDone={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/** Just the host of the server URL — the whole URL is noise inside a sentence. */
function serverHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

/**
 * The confirm for "make local only".
 *
 * Wraps the shared `ConfirmDialog` rather than replacing it, and uses its
 * `confirmDisabled` for a type-the-vault-name gate: this is the one action in
 * the app that destroys data for people who are not at the keyboard, so there is
 * deliberately no path from a single click to done.
 *
 * On failure the dialog STAYS OPEN so the server's reason (403 `owner_only`, a
 * 409 `name_mismatch`, the 502 a refusing billing provider produces) has
 * somewhere to show, with a sticky error toast beside it — a destructive path
 * must never look like a success (#85). Nothing was destroyed in that case: the
 * store only touches this device once the server has answered.
 */
export function UnsyncConfirmDialog({
  orgId,
  orgName,
  folderName,
  seed,
  onCancel,
  onDone,
}: {
  orgId: string;
  orgName: string;
  folderName: string | null;
  /** An already-loaded preview, so the page and the dialog don't both count. */
  seed?: UnsyncPreview | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const serverUrl = useStore((s) => s.serverUrl);
  const [preview, setPreview] = useState<UnsyncPreview | null>(seed ?? null);
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (seed) return;
    let cancelled = false;
    setLoading(true);
    authManager.api
      .getUnsyncPreview(orgId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, seed]);

  const run = async () => {
    setError(null);
    try {
      await useStore.getState().unsyncVault(orgId, orgName);
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(`볼트를 로컬 전용으로 바꾸지 못했어요: ${message}`, "error");
    }
  };

  const teamBilling = useStore((s) => s.billingConfig?.model === "team");
  // On Team-model servers billing belongs to the owner's account, not the
  // vault, so removing a vault never ends a subscription.
  const sub = teamBilling ? null : (preview?.subscription ?? null);

  return (
    <ConfirmDialog
      title={`${orgName}을(를) 로컬 전용으로 바꿀까요?`}
      confirmLabel="로컬 전용으로 바꾸기"
      // The name has to match exactly. The server re-checks it too (409
      // `name_mismatch`), so a slip here can't get past either gate.
      confirmDisabled={loading || typed.trim() !== orgName}
      onCancel={onCancel}
      onConfirm={run}
    >
      <p>
        파일은 그대로 남아요.{" "}
        {folderName ? (
          <>
            이 기기의 <strong>{folderName}</strong>에는 모든 노트와 첨부 파일이
            일반 파일로 남아요.
          </>
        ) : (
          "이 기기에는 모든 노트와 첨부 파일이 일반 파일로 남아요."
        )}
      </p>
      <p>
        <strong>{serverHost(serverUrl)}에서 영구 삭제돼요:</strong>
      </p>
      {loading && !preview ? (
        <p className="muted">삭제될 항목을 세는 중…</p>
      ) : preview ? (
        <ul className="confirm-list">
          <li>
            노트 {preview.notes}개와 파일 {preview.files}개, 그리고 모든 편집 기록
            {preview.checkpoints > 0
              ? ` 및 버전 체크포인트 ${preview.checkpoints}개`
              : ""}
          </li>
          {preview.members > 0 && (
            <li>
              팀원 {preview.members}명이 즉시 접근 권한을 잃어요. 각자의
              로컬 사본은 유지돼요
            </li>
          )}
          {preview.publicLinks > 0 && (
            <li>
              공개 공유 링크 {preview.publicLinks}개가 작동하지 않아요
            </li>
          )}
          {preview.mcpTokens > 0 && (
            <li>
              MCP 토큰 {preview.mcpTokens}개가 작동하지 않고 AI
              클라이언트가 접근 권한을 잃어요
            </li>
          )}
        </ul>
      ) : null}
      {sub && (
        <p>
          {sub.currentPeriodEnd
            ? `Pro는 ${formatDate(sub.currentPeriodEnd)}에 끝나요. 그때까지 결제에서 구독을 다른 볼트로 옮길 수 있어요.`
            : "Pro는 현재 결제 기간이 끝나면 종료돼요. 그때까지 결제에서 구독을 다른 볼트로 옮길 수 있어요."}
        </p>
      )}
      <p>되돌릴 수 없어요. 팀원은 우리에게서 볼트를 다시 받을 수 없어요.</p>
      <label className="confirm-type">
        <span>
          확인하려면 <strong>{orgName}</strong>을(를) 입력하세요
        </span>
        <input
          autoFocus
          value={typed}
          spellCheck={false}
          placeholder={orgName}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {error && <div className="auth-error">{error}</div>}
    </ConfirmDialog>
  );
}

/**
 * The "Freeze vault root" latch.
 *
 * A vault's top level is the one place where a stray note or folder is most
 * visible and least recoverable — everyone sees it, and nobody is sure whose it
 * is. Once a team has agreed the top-level shape, this closes it: new notes and
 * folders have to go inside an existing folder.
 *
 * Deliberately applies to EVERYONE, owners and admins included, because the
 * accidental root folder is almost always created by someone who does have
 * permission. Only an owner/admin can lift it; everyone else sees the switch in
 * its real state, disabled, so the rule is visible rather than mysterious.
 */
function FreezeRootRow({ canManage }: { canManage: boolean }) {
  const rootFrozen = useStore((s) => s.rootFrozen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await useStore.getState().setRootFrozen(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="menu-sep" />
      <label className="menu-row toggle-row freeze-root-row">
        <span className="menu-row-label">
          볼트 루트 고정
          <span className="field-hint">
            볼트 최상위에 새 항목이 만들어지지 않게 해요. 새 노트와 폴더는 기존
            폴더 안에 만들어야 해요. 나를 포함한 모든 멤버에게 적용되고, 소유자나
            관리자만 해제할 수 있어요. 이미 루트에 있는 항목은 옮기거나 이름을 바꾸거나
            숨기지 않아요.
          </span>
        </span>
        <Switch
          checked={rootFrozen}
          disabled={!canManage || busy}
          ariaLabel="볼트 루트 고정"
          title={canManage ? undefined : "소유자나 관리자만 바꿀 수 있어요"}
          onChange={(next) => void flip(next)}
        />
      </label>
      {error && <div className="auth-error">{error}</div>}
    </>
  );
}

/**
 * Locked-section gate shown for a team tab on a local vault. Its button turns
 * sync on in one click and the tab unlocks in place; signed out it raises
 * sign-in first, which turns sync on once the account is loaded.
 */
function SyncGate({ label, onRequestSignIn }: { label: string; onRequestSignIn?: () => void }) {
  const authStatus = useStore((s) => s.authStatus);
  const turningOnSync = useStore((s) => s.turningOnSync);
  const turnOn = () => {
    if (authStatus === "signed-in") {
      void useStore.getState().turnOnSyncNow();
    } else if (onRequestSignIn) {
      requestTurnOnSyncAfterAuth(true);
      onRequestSignIn();
    }
  };
  return (
    <div className="sync-gate">
      <svg
        className="sync-gate-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <h3>{label}은(는) 동기화를 켜면 사용할 수 있어요</h3>
      <p className="muted">
        이 볼트의 동기화를 켜면 사람을 초대하고, 공유와 권한을 설정하고,
        AI 클라이언트를 연결할 수 있어요.
      </p>
      <button
        className="primary"
        disabled={turningOnSync || authStatus === "unknown"}
        onClick={turnOn}
      >
        {turningOnSync ? "동기화를 켜는 중…" : <>동기화 및 공유 켜기 →</>}
      </button>
    </div>
  );
}

/** One stat tile on the team-mode Usage tab. */
interface UsageTile {
  key: string;
  caption: string;
  value: string;
  sub: string;
  meter?: { used: number; limit: number } | null;
}

/** "1.2 MB" → { value: "1.2", unit: "MB" }; plain bytes read as "bytes". */
function splitBytes(n: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(n).split(" ");
  return { value, unit: unit === "B" ? "바이트" : unit };
}

/**
 * Team model: the active vault's billing card. A user owns exactly one billing
 * account (`billing/accounts.ts`), so the only destination a move can have is
 * the caller's own account: an owner whose vault is billed on a co-owner's
 * account gets "Move to my account". There is no picker because the server
 * accepts no other destination (`POST /billing/orgs/:orgId/move` requires the
 * caller to own both the vault and the destination account).
 */
function TeamVaultBillingCard({
  orgId,
  vaultName,
  isOwner,
  plan,
  vaultAccountId,
  onMoved,
}: {
  orgId: string | null;
  vaultName: string | null;
  isOwner: boolean;
  plan: "free" | "pro" | "team";
  vaultAccountId: string | null;
  onMoved: () => Promise<unknown>;
}) {
  // Only an owner can move, so only an owner needs (or lazily creates) their account.
  const [myAccount, setMyAccount] = useState<MyBillingAccount | null>(null);
  const myAccountId = myAccount?.id ?? null;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNudge, setLimitNudge] = useState<{ kind: LimitKind; limit: number | null } | null>(
    null,
  );

  // This vault's usage, read from the account it is billed on (any member may
  // read it with `orgId`). `undefined` = loading, `null` = unavailable.
  const [usage, setUsage] = useState<BillingUsage | null | undefined>(undefined);

  // Fresh on every mount: the owner's billing account (the same source Plan &
  // Billing reads, so the pill agrees with it) and the `/mine` mirror whose
  // per-vault `accountPlan` covers vaults billed on someone else's account.
  useEffect(() => {
    void useStore.getState().refreshMyBilling();
    if (!isOwner) return;
    let live = true;
    authManager.api
      .getBillingAccount()
      .then((a) => { if (live) setMyAccount(a); })
      .catch(() => {});
    return () => { live = false; };
  }, [isOwner, orgId]);

  useEffect(() => {
    if (!orgId) {
      setUsage(null);
      return;
    }
    let live = true;
    setUsage(undefined);
    authManager.api
      .getBillingUsage({ orgId })
      .then((u) => { if (live) setUsage(u); })
      .catch(() => { if (live) setUsage(null); });
    return () => { live = false; };
  }, [orgId, vaultAccountId]);

  const usageRow = usage?.vaults.find((v) => v.orgId === orgId) ?? null;
  const ownerName = useStore((s) => {
    const owner = s.members.find((m) => m.organizationId === orgId && m.role === "owner");
    return owner?.user?.name || owner?.user?.email || null;
  });
  const planLine = vaultPlanLine({
    account: myAccount,
    vaultAccountId,
    fallbackPlan: plan,
    isOwner,
    ownerName,
    fmtDate: formatDate,
  });

  const elsewhere = isOwner && !!myAccountId && !!vaultAccountId && vaultAccountId !== myAccountId;
  const label = vaultName ?? "이 볼트";

  const runMove = async () => {
    if (!orgId || !myAccountId) return;
    setError(null);
    setLimitNudge(null);
    try {
      await authManager.api.moveVault(orgId, myAccountId);
      setConfirming(false);
      await onMoved();
      toast(`${vaultName ?? "이 볼트"}가 이제 내 계정에 속해요.`);
    } catch (e) {
      const body = e instanceof ApiError && e.body && typeof e.body === "object"
        ? (e.body as Record<string, unknown>)
        : null;
      const code = body ? (body.code ?? body.error) : null;
      if (e instanceof ApiError && e.status === 400 && code === "same_account") {
        // Already there (another device moved it): just catch up.
        setConfirming(false);
        await onMoved();
        return;
      }
      if (e instanceof ApiError && e.status === 409 && code === "vault_limit_reached") {
        setConfirming(false);
        setLimitNudge({
          kind: "vault_limit",
          limit: typeof body?.limit === "number" ? body.limit : null,
        });
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(`볼트를 옮기지 못했어요: ${message}`, "error");
    }
  };

  // Tiles: the four counts always; on Free, People carries a meter against the
  // account's ceiling and a Synced vaults tile joins only when a vault limit exists.
  const loading = usage === undefined;
  const syncedVaults = usage ? (usage.totals.vaults ?? usage.vaults.length) : 0;
  const bytes = usageRow ? splitBytes(usageRow.storageBytes) : null;
  const tiles: UsageTile[] = [
    {
      key: "people",
      caption: "사람",
      value: loading ? "…" : String(usageRow?.people ?? 0),
      sub:
        usage?.limits.people != null
          ? `이 계정에서 ${usage.limits.people}명 중`
          : "명",
      meter:
        usage?.limits.people != null && usageRow
          ? { used: usageRow.people, limit: usage.limits.people }
          : null,
    },
    {
      key: "notes",
      caption: "노트",
      value: loading ? "…" : String(usageRow?.notes ?? 0),
      sub: "이 볼트",
    },
    {
      key: "attachments",
      caption: "첨부 파일",
      value: loading ? "…" : (bytes?.value ?? "0"),
      sub: bytes?.unit ?? "바이트",
    },
    {
      key: "files",
      caption: "파일",
      value: loading ? "…" : String(usageRow?.files ?? 0),
      sub: "이 볼트",
    },
  ];
  const freeBase = useStore.getState().billingConfig?.free?.syncedVaults ?? null;
  if (usage?.limits.vaults != null) {
    tiles.push({
      key: "vaults",
      caption: "동기화 볼트",
      value: String(syncedVaults),
      sub:
        freeBase != null && usage.limits.vaults > freeBase
          ? `이 계정에서 ${usage.limits.vaults}개 중 · 이전부터 있던 볼트 포함`
          : `이 계정에서 ${usage.limits.vaults}개 중`,
      meter: { used: syncedVaults, limit: usage.limits.vaults },
    });
  }

  return (
    <>
      <div className="billing-card vault-usage">
        <div className={`plan-header${planLine.plan === "Team" ? " is-team" : ""}`}>
          <PlanHeader name={planLine.plan} pill={planLine.status} />
          {planLine.billedOn && <div className="billing-section-note muted">{planLine.billedOn}</div>}
        </div>
        {loading || (usageRow && usage) ? (
          <div className="vault-usage-tiles">
            {tiles.map((t) => {
              const full = !!t.meter && t.meter.limit > 0 && t.meter.used >= t.meter.limit;
              const pct = t.meter && t.meter.limit > 0
                ? Math.min(100, Math.round((t.meter.used / t.meter.limit) * 100))
                : 0;
              return (
                <div key={t.key} className="vault-usage-tile">
                  <span className="vault-usage-caption">{t.caption}</span>
                  <span className="vault-usage-value">{t.value}</span>
                  <span className="vault-usage-sub">{t.sub}</span>
                  {t.meter && !loading && (
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
        ) : (
          <div className="muted">지금은 이 볼트의 사용량을 볼 수 없어요.</div>
        )}
        <div className="vault-usage-footer is-end">
          <button
            className="secondary billing-action"
            onClick={() => useStore.getState().requestAccountSettings("plan")}
          >
            요금제 및 결제 열기
          </button>
        </div>
        {elsewhere && (
          <div className="vault-usage-footer">
            <span className="vault-usage-footer-label">
              대신 내 계정으로 결제하세요.
            </span>
            <button
              className="secondary billing-action"
              onClick={() => {
                setError(null);
                setLimitNudge(null);
                setConfirming(true);
              }}
            >
              내 계정으로 옮기기
            </button>
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        {limitNudge && (
          <LimitNudge
            kind={limitNudge.kind}
            limit={limitNudge.limit}
            onUpgrade={() => useStore.getState().requestAccountSettings("plan")}
          />
        )}
        {confirming && (
          <ConfirmDialog
            tone="accent"
            title={`${label}을(를) 내 계정으로 옮길까요?`}
            confirmLabel="내 계정으로 옮기기"
            onCancel={() => setConfirming(false)}
            onConfirm={runMove}
          >
            <p>
              이 볼트의 사람 수와 한도가 앞으로 내 계정에 합산되고, 지금 속한 계정에서는
              빠져요. 노트, 멤버, 권한은 그대로예요.
            </p>
          </ConfirmDialog>
        )}
      </div>
    </>
  );
}

/**
 * BillingTab: the current vault's plan and seats, then every subscription the
 * signed-in user can act on (spec 04, #109/#110).
 *
 * Three sections, in the order someone reaching for this page needs them:
 * this vault (what am I on?), all my vaults (what am I paying for?), and
 * subscriptions from deleted vaults (what am I paying for that no longer
 * exists?). Facts are visible to every member; each action is gated to the
 * role the server will actually accept — Upgrade and Manage for owners and
 * admins, Transfer for owners only, because it changes who pays for what.
 *
 * Only the first section needs a synced vault; the other two are account-wide,
 * which is why this tab is no longer in TEAM_TABS.
 */
function BillingTab({ canManage, isSynced }: { canManage: boolean; isSynced: boolean }) {
  const billingConfig = useStore((s) => s.billingConfig);
  const orgBilling = useStore((s) => s.orgBilling);
  const myBilling = useStore((s) => s.myBilling);
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);

  // The vault the upgrade dialog should charge: the active one from the card
  // at the top, or any owned free vault picked out of the list below.
  const [upgradeOrg, setUpgradeOrg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A transfer being set up: the source row's Transfer was clicked and the
  // dialog is open. `targetOrgId` is the pick, null until one is made (or the
  // only eligible vault, pre-picked). It moves money between vaults, so the
  // dialog is where both the choice AND the confirmation happen — never a
  // popover that fires on the first click.
  const [transfer, setTransfer] = useState<{
    sourceOrgId: string;
    sourceLabel: string;
    targetOrgId: string | null;
  } | null>(null);
  // An orphaned subscription waiting on a "cancel now" confirmation.
  const [cancelling, setCancelling] = useState<{ orgId: string; label: string } | null>(
    null,
  );

  // Refresh this vault's seats AND the account-wide list whenever the tab opens.
  useEffect(() => {
    void useStore.getState().refreshOrgBilling();
    void useStore.getState().refreshMyBilling();
  }, []);

  const refreshAll = async () => {
    await Promise.all([
      useStore.getState().refreshMyBilling(),
      useStore.getState().refreshOrgBilling(),
    ]);
  };

  /** Open a vault's provider portal in the OS browser (owner/admin). */
  const openPortal = async (portalOrgId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await authManager.api.getBillingPortalUrl(portalOrgId);
      await ipc.openExternal(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Both confirmed actions leave their dialog OPEN on failure and report into
  // it, rather than closing over an error nobody sees. Neither re-throws — the
  // dialog's own AsyncButton has finished reporting by then.
  const runTransfer = async () => {
    if (!transfer || !transfer.targetOrgId) return;
    const { sourceOrgId, targetOrgId } = transfer;
    const targetName = vaults.find((v) => v.orgId === targetOrgId)?.name ?? "그 볼트";
    setError(null);
    try {
      await authManager.api.transferSubscription(sourceOrgId, targetOrgId);
      setTransfer(null);
      await refreshAll();
      toast(`Pro를 ${targetName}(으)로 옮겼어요.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(`구독을 옮기지 못했어요: ${message}`, "error");
    }
  };

  const runCancelNow = async () => {
    if (!cancelling) return;
    const { orgId: target, label } = cancelling;
    setError(null);
    try {
      await authManager.api.cancelSubscription(target, "now");
      setCancelling(null);
      await refreshAll();
      toast(`${label}의 구독을 취소했어요.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast(`구독을 취소하지 못했어요: ${message}`, "error");
    }
  };

  if (!billingConfig?.enabled) {
    return (
      <div className="muted perm-empty">이 서버에서는 결제가 켜져 있지 않아요.</div>
    );
  }

  // Team model: billing lives on the owner's account (Account Settings → Plan &
  // Billing); this tab (labelled Usage) shows the vault's own usage. No per-vault subscription list and no transfer here.
  if (billingConfig.model === "team") {
    const row = myBilling?.vaults.find((v) => v.orgId === orgId) ?? null;
    return (
      <TeamVaultBillingCard
        orgId={orgId}
        vaultName={row?.name ?? null}
        isOwner={row?.role === "owner"}
        plan={row?.accountPlan ?? orgBilling?.accountPlan ?? "free"}
        vaultAccountId={row?.accountId ?? orgBilling?.accountId ?? null}
        onMoved={refreshAll}
      />
    );
  }

  const vaults = myBilling?.vaults ?? [];
  const orphaned = myBilling?.orphaned ?? [];
  const freeLimits = myBilling?.freeLimits ?? null;

  /**
   * The Transfer control for one row. It opens the transfer dialog, where the
   * eligible destinations are laid out with their seats and plan and the move
   * is confirmed in the same place. With exactly one eligible vault it is
   * pre-picked, so the common case is still one click plus a confirm.
   *
   * No eligible vault ⇒ a disabled control that says why, rather than a menu
   * with nothing in it.
   */
  const transferControl = (sourceOrgId: string, sourceLabel: string) => {
    const targets = transferTargets(vaults, sourceOrgId);
    if (targets.length === 0) {
      return (
        <button
          className="link-btn"
          disabled
          title="옮길 곳이 없어요. 이미 Pro가 아닌 내 소유의 다른 볼트가 필요해요."
        >
          이전
        </button>
      );
    }
    return (
      <button
        type="button"
        className="link-btn"
        disabled={busy}
        aria-label={`${sourceLabel}의 구독을 다른 볼트로 옮기기`}
        onClick={() => {
          setError(null);
          setTransfer({
            sourceOrgId,
            sourceLabel,
            targetOrgId: targets.length === 1 ? targets[0].orgId : null,
          });
        }}
      >
        이전
      </button>
    );
  };

  /**
   * The transfer dialog body: the eligible destinations as selectable cards.
   * Each card carries what the reader weighs when choosing — the vault's
   * seats, and that it is on Free today — instead of a bare name.
   */
  const renderTransferDialog = () => {
    if (!transfer) return null;
    const targets = transferTargets(vaults, transfer.sourceOrgId);
    const target = targets.find((t) => t.orgId === transfer.targetOrgId) ?? null;
    // Owned vaults that are NOT offered, so the list's gaps are explained.
    const skipped = vaults.filter(
      (v) => v.orgId !== transfer.sourceOrgId && v.role === "owner" && !targets.includes(v),
    ).length;
    return (
      <ConfirmDialog
        tone="accent"
        title={`${transfer.sourceLabel}의 Pro 옮기기`}
        confirmLabel={target ? `Pro를 ${target.name}(으)로 옮기기` : "구독 옮기기"}
        confirmDisabled={!target}
        onCancel={() => setTransfer(null)}
        onConfirm={runTransfer}
      >
        <p>
          Pro가 될 볼트를 고르세요. 결제 기간과 가격은 그대로예요.
          <strong>{transfer.sourceLabel}</strong>은(는) Free로 바뀌어요. 멤버와 노트는
          그대로이지만 첨부 파일은 동기화되지 않아요. 각 기기의 로컬 사본은 모두
          그대로 사용할 수 있어요.
        </p>
        <div className="transfer-targets" role="radiogroup" aria-label="대상 볼트">
          {targets.map((t) => {
            const used = t.seats.members + t.seats.pendingInvitations;
            const selected = t.orgId === transfer.targetOrgId;
            return (
              <button
                key={t.orgId}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`upgrade-plan-card transfer-target${selected ? " selected" : ""}`}
                onClick={() => setTransfer({ ...transfer, targetOrgId: t.orgId })}
              >
                <span className="transfer-target-name">{t.name}</span>
                <span className="transfer-target-meta">
                  멤버 {t.seats.limit ?? "∞"}명 중 {used}명 · Free
                </span>
              </button>
            );
          })}
        </div>
        {skipped > 0 && (
          <p className="transfer-targets-note">
            이미 Pro가 아닌 내 소유의 볼트만 표시돼요.
          </p>
        )}
        {error && <div className="auth-error">{error}</div>}
      </ConfirmDialog>
    );
  };

  /** Section 1 — the vault currently open. A plain render helper, NOT a nested
   *  component: a component declared in here would remount its whole subtree
   *  on every state change of this page. */
  const renderVaultCard = () => {
    if (!isSynced || !orgId) {
      // A card, not a bare line: this slot holds the Pro/Free card in every
      // other state, and a naked sentence there left the tab starting on
      // nothing and the Subscriptions list looking like the whole page.
      return (
        <div className="billing-card">
          <div className="muted">
            이 볼트는 동기화되지 않아서 자체 요금제가 없어요. 내 계정의 볼트는
            아래에 표시돼요.
          </div>
        </div>
      );
    }
    if (!orgBilling) return <div className="muted">Loading…</div>;

    if (orgBilling.plan === "pro") {
      return (
        <div className="billing-card plan-pro">
          <div className="billing-plan-head">
            <span className="billing-plan-name">Pro</span>
            <span className={`billing-status ${orgBilling.status}`}>
              {orgBilling.status === "past_due"
                ? "결제 지연"
                : orgBilling.status === "canceled"
                  ? "취소됨"
                  : "활성"}
            </span>
          </div>
          <div className="muted">
            첨부 파일 동기화가 여러 기기와 팀에서 켜져 있어요.
          </div>
          {orgBilling.currentPeriodEnd && (
            <div className="menu-row">
              <span className="menu-row-label">
                {orgBilling.cancelAtPeriodEnd ? "이용 가능 기간" : "갱신일"}
              </span>
              <span>{formatDate(orgBilling.currentPeriodEnd)}</span>
            </div>
          )}
          {orgBilling.cancelAtPeriodEnd && (
            <div className="limit-nudge">
              <span>
                구독이 현재 결제 기간이 끝나면 취소되도록 설정돼 있어요.
              </span>
            </div>
          )}
          {canManage ? (
            <AsyncButton
              className="secondary billing-action"
              disabled={busy}
              onClick={() => openPortal(orgId)}
            >
              구독 관리
            </AsyncButton>
          ) : (
            <div className="muted">소유자나 관리자에게 구독 관리를 요청하세요.</div>
          )}
        </div>
      );
    }

    const { members, pendingInvitations, limit } = orgBilling.seats;
    const used = members + pendingInvitations;
    return (
      <div className="billing-card">
        <div className="billing-plan-head">
          <span className="billing-plan-name">Free</span>
        </div>
        <div className="menu-row">
          <span className="menu-row-label">멤버</span>
          <span>
            {limit ?? "∞"}명 중 {used}명
            {limit != null && used >= limit ? " · 가득 참" : ""}
          </span>
        </div>
        {pendingInvitations > 0 && (
          <div className="muted">
            대기 중인 초대 {pendingInvitations}건이 포함돼 있어요.
          </div>
        )}

        <div className="subhead">Pro로 업그레이드하면 열려요</div>
        <div className="muted">{legacyFreePlanExplanation(billingConfig.freeLimits)}</div>
        <ul className="upgrade-features">
          {LEGACY_PRO_BENEFITS.map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>

        {canManage ? (
          <button className="primary billing-action" onClick={() => setUpgradeOrg(orgId)}>
            Pro로 업그레이드
          </button>
        ) : (
          <div className="muted">소유자나 관리자에게 이 볼트의 업그레이드를 요청하세요.</div>
        )}
      </div>
    );
  };

  /** One row of section 2. */
  const renderVaultRow = (v: MyBillingVault) => {
    const seatsUsed = v.seats.members + v.seats.pendingInvitations;
    // One meta line, not three: renewal + price (already joined by
    // `subscriptionStatusLine`), then seats, then who pays when that isn't the
    // reader. A row is a name and a fact line, so the list scans vertically.
    const meta = [
      subscriptionStatusLine(v, LINE_FORMAT),
      `멤버 ${v.seats.limit ?? "∞"}명 중 ${seatsUsed}명`,
      !v.canManage && v.billingOwner ? `${v.billingOwner.name}님에게 청구` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={v.orgId} className="billing-sub-row">
        <span className="billing-sub-name">
          <span className="billing-sub-title">
            <span className="billing-sub-vault">{v.name}</span>
            {/* A pill, not muted trailing text: it labels the row the reader
                arrived from, so it has to survive the name's ellipsis. */}
            {v.orgId === orgId && <span className="member-role">현재</span>}
          </span>
          {meta && <span className="billing-sub-meta">{meta}</span>}
        </span>
        {/* Owner is the default for a vault you are billed for, and the row
            already carries Current + plan pills plus up to three actions — so
            the role pill only appears when the role is worth saying. */}
        {v.role !== "owner" && <span className={`member-role ${v.role}`}>{v.role}</span>}
        <span className={`billing-status ${v.status}`}>{planPillLabel(v)}</span>
        <span className="vault-row-actions">
          {v.canManage && v.plan === "free" && (
            <AsyncButton
              className="link-btn"
              disabled={busy}
              onClick={() => setUpgradeOrg(v.orgId)}
            >
              업그레이드
            </AsyncButton>
          )}
          {v.canManage && v.plan === "pro" && (
            <AsyncButton
              className="link-btn"
              disabled={busy}
              onClick={() => openPortal(v.orgId)}
            >
              관리
            </AsyncButton>
          )}
          {v.canTransfer && transferControl(v.orgId, v.name)}
        </span>
      </li>
    );
  };

  return (
    <>
      {renderVaultCard()}

      {/* ---- 2. Every vault on the account ---- */}
      <div className="subhead">구독</div>
      {vaults.length === 0 ? (
        <div className="muted perm-empty">
          {myBilling ? "이 계정에는 아직 볼트가 없어요." : "불러오는 중…"}
        </div>
      ) : (
        <ul className="member-list">{vaults.map(renderVaultRow)}</ul>
      )}

      {/* ---- 3. Tombstones: paid time that outlived its vault ---- */}
      {orphaned.length > 0 && (
        <>
          <div className="subhead">삭제된 볼트의 구독</div>
          <div className="billing-section-note">
            삭제된 볼트에 속했던 구독이에요. 종료될 때까지 계속 결제돼요. 결제한 기간을
            쓰려면 다른 볼트로 옮기거나 지금 취소하세요.
          </div>
          <ul className="member-list">
            {orphaned.map((o) => {
              const label = o.orgName ?? "삭제된 볼트";
              // Same two-line shape as a live vault row: the name leads, and
              // when it was deleted is a fact on the meta line, not a
              // parenthetical that competes with the name for the ellipsis.
              const meta = [
                `${formatDate(o.deletedAt)}에 삭제됨`,
                subscriptionStatusLine(o, LINE_FORMAT),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={o.orgId} className="billing-sub-row">
                  <span className="billing-sub-name">
                    <span className="billing-sub-title">
                      <span className="billing-sub-vault">{label}</span>
                    </span>
                    <span className="billing-sub-meta">{meta}</span>
                  </span>
                  <span className={`billing-status ${o.status}`}>
                    {o.status === "past_due" ? "결제 지연" : "Pro"}
                  </span>
                  <span className="vault-row-actions">
                    {transferControl(o.orgId, label)}
                    <AsyncButton
                      className="link-btn danger"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setCancelling({ orgId: o.orgId, label });
                      }}
                    >
                      지금 취소
                    </AsyncButton>
                    <AsyncButton
                      className="link-btn"
                      disabled={busy}
                      onClick={() => openPortal(o.orgId)}
                    >
                      관리
                    </AsyncButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---- 4. What the free tier allows ---- */}
      {freeLimits && (
        <div className="menu-row settings-footer-row">
          <span className="menu-row-label">무료 볼트</span>
          <span>
            {freeLimits.vaultsPerUser}개 중 {freeLimits.freeVaultsUsed}개 사용
          </span>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {upgradeOrg && (
        <UpgradeDialog orgId={upgradeOrg} onClose={() => setUpgradeOrg(null)} />
      )}

      {renderTransferDialog()}

      {cancelling && (
        <ConfirmDialog
          title={`${cancelling.label}의 구독을 취소할까요?`}
          confirmLabel="구독 취소"
          cancelLabel="유지"
          onCancel={() => setCancelling(null)}
          onConfirm={runCancelNow}
        >
          <p>
            결제가 지금 중단되고 남은 기간은 포기돼요. 이 기간을 쓸 볼트가
            남아 있지 않으므로 다른 손실은 없어요.
          </p>
          <p>
            결제한 기간을 유지하고 싶다면 대신 다른 볼트로 옮기세요.
          </p>
          {error && <div className="auth-error">{error}</div>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Compact absolute date for renewal/period-end lines. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * How a subscription row writes its date and price. Both formatters already
 * exist — reused here rather than re-implemented so `lib/billing.ts` can stay
 * pure and there is exactly one definition of how we print money.
 */
const LINE_FORMAT = {
  date: formatDate,
  price: (amount: number, currency: string, interval: "month" | "year" | null) =>
    `${formatPrice({ amount, currency })}${interval ? perLabel(interval) : ""}`,
};

/**
 * Versioning: the vault-wide safety net. Lists the vault's checkpoints (max 5 —
 * a daily automatic one plus manual ones, or one manual one a week where the
 * server's `schedule` says so), and lets an owner OR admin take one
 * and roll the whole vault back to it. Per-note history lives in the editor's
 * version panel; this page is for the blast-radius case ("the reorg went wrong,
 * put everything back").
 *
 * Revert used to be owner-only. It is the recovery half of an action admins
 * could already take (create/delete a checkpoint), so a team whose owner was
 * away could take checkpoints and not use them.
 */
function VersioningTab({ canManage }: { canManage: boolean }) {
  const checkpoints = useStore((s) => s.checkpoints);
  const schedule = useStore((s) => s.checkpointSchedule);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VaultCheckpoint | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // No schedule (an older server) means today's cadence: daily + unlimited.
  const auto = schedule?.auto ?? true;
  const nextManualMs = schedule?.nextManualAt ? Date.parse(schedule.nextManualAt) : NaN;
  const manualWaiting = Number.isFinite(nextManualMs) && nextManualMs > now;

  useEffect(() => {
    void useStore.getState().refreshCheckpoints();
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const create = async () => {
    setError(null);
    try {
      await useStore.getState().createCheckpoint(label);
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A refusal for the weekly window carries the date; re-read the schedule
      // so Create disables until then.
      void useStore.getState().refreshCheckpoints();
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await useStore.getState().deleteCheckpoint(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revert = async (cp: VaultCheckpoint) => {
    setError(null);
    try {
      const result = await useStore.getState().revertVaultToCheckpoint(cp.id);
      setConfirming(null);
      toast(
        `볼트를 되돌렸어요: 노트 ${result.docsChanged}개 변경, ` +
          `${result.docsRestored}개 복원, ${result.docsDeleted}개 제거`,
        "success",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="versioning-tab">
      <p className="versioning-lede">
        {auto
          ? "체크포인트는 이 볼트의 모든 노트와 폴더를 저장해요. 볼트가 바뀐 날마다 " +
            "하나씩 만들어지고, 최근 5개가 유지돼요. 되돌리면 모든 멤버의 " +
            "볼트가 되돌아가요."
          : "체크포인트는 이 볼트의 모든 노트와 폴더를 저장해요. 일주일에 한 번 만들 수 있고, " +
            "최근 5개가 유지돼요. 되돌리면 모든 멤버의 볼트가 되돌아가요."}
      </p>
      {error && <div className="auth-error">{error}</div>}
      <div className="profile-rows versioning-rows">
        {canManage && (
          <div className="profile-row">
            <div className="profile-row-label">
              <span className="profile-row-title">새 체크포인트</span>
              <span className="profile-row-hint">큰 변경 전에 지금 상태의 볼트를 저장하세요.</span>
            </div>
            <div className="profile-row-control">
              <form
                className="checkpoint-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!manualWaiting) void create();
                }}
              >
                <input
                  type="text"
                  placeholder="라벨(선택), 예: 대규모 개편 전"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <AsyncButton className="checkpoint-ink-btn" onClick={create} disabled={manualWaiting}>
                  만들기
                </AsyncButton>
              </form>
              {manualWaiting && (
                <div className="muted checkpoint-note">
                  다음 체크포인트는{" "}
                  {new Date(nextManualMs).toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}에 만들 수 있어요.
                </div>
              )}
            </div>
          </div>
        )}
        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">체크포인트</span>
            <span className="profile-row-hint">
              최신순이에요. 되돌리기 전에 현재 상태가 체크포인트로 먼저 저장돼서 되돌리기를 취소할 수 있어요.
            </span>
          </div>
          <div className="profile-row-control">
            {checkpoints == null ? (
              <div className="muted perm-empty">불러오는 중…</div>
            ) : checkpoints.length === 0 ? (
              <div className="muted perm-empty">
                {auto ? (
                  <>
                    아직 체크포인트가 없어요. 볼트가 바뀌면 하루 안에 자동으로 하나가
                    만들어져요{canManage ? ". 위에서 직접 만들 수도 있어요" : ""}.
                  </>
                ) : (
                  <>아직 체크포인트가 없어요{canManage ? ". 위에서 만들어 보세요" : ""}.</>
                )}
              </div>
            ) : (
              <ul className="checkpoint-cards">
                {checkpoints.map((cp) => (
                  <li key={cp.id} className="checkpoint-card">
                    <span className={`checkpoint-icon${cp.kind === "manual" ? " is-manual" : ""}`} aria-hidden="true">
                      {cp.kind === "manual" ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      )}
                    </span>
                    <span className="checkpoint-main">
                      <span className="checkpoint-title">{checkpointName(cp)}</span>
                      <span className="checkpoint-sub">
                        {checkpointWhen(cp.createdAt, now)}
                        {cp.createdByName ? ` · ${cp.createdByName}` : cp.kind === "auto" ? " · 자동" : ""}
                        {" · "}
                        {noteCountLabel(cp.noteCount)}
                      </span>
                    </span>
                    {canManage && (
                      <>
                        <button type="button" className="checkpoint-revert" onClick={() => setConfirming(cp)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                          되돌리기
                        </button>
                        <RowActionsMenu
                          ariaLabel={`${checkpointName(cp)} 작업`}
                          actions={[
                            { key: "delete", label: "체크포인트 삭제", danger: true, onSelect: () => remove(cp.id) },
                          ]}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {!canManage && (
        <div className="muted checkpoint-note">
          볼트 소유자나 관리자만 체크포인트로 되돌릴 수 있어요.
        </div>
      )}
      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal checkpoint-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>볼트 전체를 되돌릴까요?</h2>
            </div>
            <p className="muted">
              모든 노트가 {checkpointWhen(confirming.createdAt, now)}의{" "}
              <strong>{checkpointName(confirming)}</strong> 상태로 돌아가요. 내용, 이름,
              폴더가 모든 멤버에게 실시간으로 되돌아가요. 그 이후에 만든 노트는
              휴지통으로 이동해요. 첨부 파일은 되돌리지 않아요. 현재 상태의 체크포인트를
              먼저 저장하므로 되돌리기를 취소할 수 있어요.
            </p>
            <div className="banner-actions checkpoint-confirm-actions">
              <button className="secondary" onClick={() => setConfirming(null)}>
                취소
              </button>
              <AsyncButton
                className="primary danger"
                spinnerTone="on-accent"
                onClick={() => revert(confirming)}
              >
                볼트 되돌리기
              </AsyncButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A checkpoint's name without its time: the label, or what made it. */
function checkpointName(cp: VaultCheckpoint): string {
  return cp.label?.trim() || (cp.kind === "manual" ? "수동 체크포인트" : "일일 체크포인트");
}

/** "Today, 3:02 PM", "Yesterday, 9:00 AM", or "Thu 29 Oct, 9:00 AM". */
function checkpointWhen(iso: string, now: number): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (t: number) => new Date(t).toDateString();
  if (day(d.getTime()) === day(now)) return `오늘 ${time}`;
  if (day(d.getTime()) === day(now - 86_400_000)) return `어제 ${time}`;
  const date = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${date}, ${time}`;
}

function importSummaryText(s: ipc.ImportSummary): string {
  const parts = [`파일 ${s.files}개를 가져왔어요`];
  if (s.skipped > 0) parts.push(`${s.skipped}개 건너뜀`);
  return parts.join(" · ") + ".";
}

/**
 * Import / Export — vault-level data operations on the open local vault. Imports
 * land at the vault root; exports copy out to a chosen folder. The same commands
 * back the sidebar ⋮ menu and drag-and-drop, so behavior is identical everywhere.
 */
function ImportExportTab() {
  const [busy, setBusy] = useState<null | "files" | "folder" | "export">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await useStore.getState().refreshTree();
    await useStore.getState().refreshTitles();
  }

  async function run(
    kind: "files" | "folder" | "export",
    fn: () => Promise<string | null>,
  ) {
    setBusy(kind);
    setError(null);
    setMsg(null);
    try {
      const result = await fn();
      if (result) setMsg(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const importFiles = () =>
    run("files", async () => {
      // Captured before the native picker — a vault switch while it is open must
      // not redirect the import into the vault the user landed in.
      const epoch = useStore.getState().vault?.epoch;
      const sources = await ipc.pickFiles();
      if (!sources || sources.length === 0) return null;
      const summary = await ipc.importPaths("", sources, epoch);
      await refresh();
      return importSummaryText(summary);
    });

  const importFolder = () =>
    run("folder", async () => {
      const epoch = useStore.getState().vault?.epoch; // before the dialog
      const src = await ipc.pickFolder();
      if (!src) return null;
      const summary = await ipc.importPaths("", [src], epoch);
      await refresh();
      return importSummaryText(summary);
    });

  const exportVault = () =>
    run("export", async () => {
      const epoch = useStore.getState().vault?.epoch; // before the dialog
      const dest = await ipc.pickFolder();
      if (!dest) return null;
      await ipc.exportPath("", dest, epoch);
      return "볼트를 내보냈어요.";
    });

  return (
    <div className="io-tab">
      <div className="io-list">
        <div className="io-row">
          <span className="io-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3 3 3-3" /></svg>
          </span>
          <span className="io-text">
            파일 가져오기
            <small>Markdown과 텍스트는 노트가 되고, 나머지는 그대로 보관돼요.</small>
          </span>
          <button className="ghost-pill" disabled={busy !== null} onClick={() => void importFiles()}>
            {busy === "files" ? "가져오는 중…" : "파일 선택…"}
          </button>
        </div>
        <div className="io-row">
          <span className="io-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 10v6M9 13l3 3 3-3" /></svg>
          </span>
          <span className="io-text">
            폴더 가져오기
            <small>폴더 구조를 유지해요. 기존 이름은 덮어쓰지 않아요.</small>
          </span>
          <button className="ghost-pill" disabled={busy !== null} onClick={() => void importFolder()}>
            {busy === "folder" ? "가져오는 중…" : "폴더 선택…"}
          </button>
        </div>
        <div className="io-row">
          <span className="io-icon is-export" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 15V4M8 8l4-4 4 4" /></svg>
          </span>
          <span className="io-text">
            이 볼트 내보내기
            <small>모든 노트와 파일의 사본을 컴퓨터의 폴더에 저장해요.</small>
          </span>
          <button className="ghost-pill" disabled={busy !== null} onClick={() => void exportVault()}>
            {busy === "export" ? "내보내는 중…" : "내보내기…"}
          </button>
        </div>
      </div>
      <p className="io-tip">팁: 사이드바의 폴더에 파일을 끌어다 놓거나 폴더를 우클릭해서 그곳으로 가져올 수 있어요.</p>

      {error ? (
        <div className="auth-error">{error}</div>
      ) : (
        msg && <div className="io-result">{msg}</div>
      )}
    </div>
  );
}

function AppearanceTab({ canManage, isSynced }: { canManage: boolean; isSynced: boolean }) {
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const settings = useStore((s) => (orgId ? s.vaultAppearance[orgId] : undefined)) ?? EMPTY_APPEARANCE;
  // Sliders fire on every pixel of a drag: apply locally at once, PUT once
  // the thumb rests for 300 ms. Everything else saves on change.
  const pending = useRef<{ timer: number; settings: AppearanceSettings } | null>(null);

  useEffect(() => {
    if (orgId && isSynced) void useStore.getState().loadVaultAppearance(orgId);
  }, [orgId, isSynced]);
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: AppearanceSettings) {
    if (!orgId) return;
    useStore.getState().saveVaultAppearance(orgId, next).catch((e: unknown) => {
      // The change was applied optimistically and has just been rolled back:
      // say so, with the server's reason, so a refused save is never silent.
      const body = e instanceof ApiError ? (e.body as { error?: string; key?: string } | undefined) : undefined;
      const reason =
        body?.error === "invalid_appearance"
          ? `서버가 ${body.key ? `"${body.key}"` : "값"}을(를) 거부했어요`
          : e instanceof Error
            ? e.message
            : String(e);
      toast(`볼트 화면 설정을 저장하지 못해서 원래대로 되돌렸어요: ${reason}.`, "error");
    });
  }
  function flush() {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    save(p.settings);
  }
  // Every save is the whole, concrete object: a key an older row never saved
  // is written as the app default it was already showing.
  const change = <K extends AppearanceKey>(key: K, value: ResolvedAppearance[K]) => {
    if (!orgId) return;
    const next: AppearanceSettings = {
      ...useStore.getState().vaultAppearance[orgId],
      ...vaultAppearanceValues(useStore.getState().vaultAppearance[orgId]),
      [key]: value,
    };
    if (key === "contentWidth" || key === "textSize") {
      useStore.getState().receiveVaultAppearance(orgId, next); // optimistic
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = { settings: next, timer: window.setTimeout(flush, 300) };
      return;
    }
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    save(next);
  };
  const resetToDefaults = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    save({ ...APPEARANCE_DEFAULTS });
  };

  return (
    <>
      {isSynced && orgId ? (
        <>
          <div className="subhead appearance-defaults-head">
            이 볼트 모든 멤버의 기본값
            {!canManage && <span className="appearance-tag">볼트 소유자가 설정함</span>}
          </div>
          <div className="muted">
            각자의 화면 설정에서 따로 바꿀 수 있어요.
          </div>
          <AppearanceRows
            mode="vault"
            values={vaultAppearanceValues(settings)}
            onChange={change}
            readOnly={!canManage}
          />
          {canManage && (
            <button className="link-btn" onClick={resetToDefaults}>
              기본값으로 되돌리기
            </button>
          )}
        </>
      ) : (
        <div className="menu-row">
          <span className="menu-row-label">테마</span>
          <ThemeToggle />
        </div>
      )}
    </>
  );
}

const EMPTY_APPEARANCE: AppearanceSettings = {};
