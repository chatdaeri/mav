/* Account Settings → Vaults. Vaults belong to the account (owner decision
   2026-10-07), so the one list of them lives here rather than in Vault
   Settings: the synced vaults this account is a member of, the local folders
   this app profile has opened, and where new vault folders go. Moved verbatim
   from the old Vault Settings → Vaults tab; the people/notes counts come from
   the account's billing usage when the server bills per seat. Rows carry no
   plan pill (the plan is the account's, said in Plan & Billing); only a
   lapsed account's vaults get a "Read-only" pill, since that changes the row. */
import { useEffect, useState } from "react";
import { ApiError, type BillingUsage, type MyBillingAccount, type OrgBilling } from "../lib/api";
import { toast } from "../lib/toast";
import { folderErrorText } from "../lib/vault/folderErrors";
import { authManager } from "../lib/auth/authManager";
import { classifyLimitError, type LimitKind, limitFromError } from "../lib/billing";
import * as ipc from "../lib/ipc";
import { readOrgVaults, useStore } from "../store";
import { AsyncButton } from "./AsyncButton";
import { InvitationRows, useFreshInvitations } from "./InvitationRows";
import { ConfirmDialog } from "./ConfirmDialog";
import { VaultFolderMissingRowActions } from "./VaultFolderMissing";
import { useResetLocalCopy } from "./useResetLocalCopy";
import { type RowAction, RowActionsMenu } from "./RowActionsMenu";
import { VaultTile } from "./VaultSwitcher";
import {
  localCardLabels,
  vaultCardLabels,
  vaultSlugLabel,
} from "../lib/accountVaultsView";
import { LimitNudge } from "./LimitNudge";
import { UpgradeDialog } from "./UpgradeDialog";
import { useLocalFolderClasses, useLocalVaults } from "./useVaultLists";
import { hiddenForeignFootnote, visibleFolders } from "../lib/vault/vaultList";
import { formatDate, UnsyncConfirmDialog } from "./VaultSettingsDialog";
import { AccountVaultPage } from "./AccountVaultPage";
import {
  vaultPageDetails,
  vaultPagePlanLine,
  vaultPageRole,
  vaultSettingsAction,
} from "../lib/accountVaultPage";

const CURRENT_LINK_TIP =
  '지금 열린 볼트는 "current" 경로로도 연결돼서, Claude Desktop 같은 도구가 고정된 한 경로를 가리킬 수 있어요.';

/**
 * Vaults: switch between vaults, create/join, and manage where their
 * local folders live. Each vault owns one folder under the managed root;
 * switching swaps the sidebar to that vault's folder and repoints the
 * stable `current` symlink external tools point at.
 */
export function AccountVaultsTab() {
  const session = useStore((s) => s.session);
  // Pending invitations get their own section above the synced list, with the
  // account menu's rows; showing them here marks them seen, like the menu.
  const userInvitations = useStore((s) => s.userInvitations);
  const freshInviteIds = useFreshInvitations(userInvitations);
  const reset = useResetLocalCopy();
  const organizations = useStore((s) => s.organizations);
  const members = useStore((s) => s.members);
  const vault = useStore((s) => s.vault);
  const syncEnabled = useStore((s) => s.syncEnabled);
  // The open vault's folder is gone (#228): its row says so instead of
  // "Current" and offers the banner's recovery actions.
  const rootMissing = useStore((s) => s.structureNotice.rootMissing);
  const billingEnabled = useStore((s) => s.billingConfig?.enabled === true);
  const teamBilling = useStore((s) => s.billingConfig?.model === "team");
  // Bumped after a local remove/delete so the recents list re-fetches.
  const [localsNonce, setLocalsNonce] = useState(0);
  const locals = useLocalVaults(localsNonce);
  const { classes: folderClasses, resolved: foldersResolved } = useLocalFolderClasses(
    locals,
    session ? organizations.map((o) => o.id) : [],
  );

  const [root, setRoot] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [bound, setBound] = useState<Record<string, string>>(() => readOrgVaults());
  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The vault whose permanent deletion is awaiting the standard confirm dialog.
  const [confirmDelete, setConfirmDelete] = useState<{ orgId: string; name: string } | null>(
    null,
  );
  // A vault that is actually PAYING, whose deletion needs the full dialog
  // instead: the two-click row has nowhere to say what happens to the money
  // (#111). Its billing snapshot rides along so the copy can name the date.
  const [subDelete, setSubDelete] = useState<
    { orgId: string; name: string; billing: OrgBilling } | null
  >(null);
  // The local vault whose folder deletion is awaiting the standard confirm dialog.
  const [confirmDeleteLocal, setConfirmDeleteLocal] = useState<
    { path: string; name: string } | null
  >(null);
  // A vault the user is about to leave (#121). Always the full dialog: it has
  // to say that the folder on this device goes too, which a row can't.
  const [confirmLeave, setConfirmLeave] = useState<{ orgId: string; name: string } | null>(
    null,
  );
  // A vault the user is about to make LOCAL ONLY. Always the full dialog: the
  // counts, the teammates who lose access and the type-the-name gate have
  // nowhere to live in a two-click row.
  const [confirmUnsync, setConfirmUnsync] = useState<{ orgId: string; name: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  // The vault whose page is open (a card was clicked); null = the list.
  const [pageOrgId, setPageOrgId] = useState<string | null>(null);
  // Split view (list on the left, the selected vault's page on the right).
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [vaultQuery, setVaultQuery] = useState("");
  // Synced vaults and local folders get equal billing: one switch picks which
  // list fills the page.
  const [scope, setScope] = useState<"synced" | "local">(session ? "synced" : "local");
  // Free-plan vault-cap hit while creating — shows an upgrade nudge instead.
  const [limitNudge, setLimitNudge] = useState<{ kind: LimitKind; limit: number | null } | null>(
    null,
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Team-model billing: the read-only pill and per-vault counts. Loaded once; a
  // failure (or billing off) just renders the rows without them.
  const billingConfig = useStore((s) => s.billingConfig);
  const [billing, setBilling] = useState<
    { account: MyBillingAccount; usage: BillingUsage } | null
  >(null);
  // True until the usage answers (or fails): the vault page shows skeletons.
  const [billingLoading, setBillingLoading] = useState(false);
  const usageShown = !!session && billingConfig?.enabled === true && billingConfig.model === "team";
  useEffect(() => {
    if (!session || !billingConfig?.enabled || billingConfig.model !== "team") {
      setBilling(null);
      setBillingLoading(false);
      return;
    }
    let live = true;
    setBillingLoading(true);
    Promise.all([authManager.api.getBillingAccount(), authManager.api.getBillingUsage()])
      .then(([account, usage]) => { if (live) setBilling({ account, usage }); })
      .catch(() => { if (live) setBilling(null); })
      .finally(() => { if (live) setBillingLoading(false); });
    return () => { live = false; };
  }, [session, billingConfig?.enabled, billingConfig?.model]);
  const usageFor = (orgId: string) =>
    billing?.usage.vaults.find((v) => v.orgId === orgId) ?? null;
  // The account's plan applies to every row, so it is not repeated per row;
  // only a lapsed account (sync read-only for its vaults) earns a pill.
  const accountLapsed = !!billing?.account.lapsed;
  const freeVaultLimit =
    billing && billing.account.plan === "free"
      ? (billing.usage.limits.vaults ?? billing.account.limits.vaults)
      : null;
  const baseFreeVaults = billingConfig?.free?.syncedVaults ?? null;

  useEffect(() => {
    let cancelled = false;
    ipc
      .getVaultsRoot()
      .then((r) => {
        if (!cancelled) setRoot(r);
      })
      .catch((e) => {
        // Show WHY there is no root (e.g. macOS blocked Documents), not "…".
        if (!cancelled) setRootError(folderErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrgId = session?.activeOrganizationId ?? null;
  // We only know the caller's role for the ACTIVE vault (members are loaded
  // for it alone). On the active row we can therefore hide Delete from
  // non-owners; on other rows we can't tell, so we show it and let the server
  // enforce owner-only (403, surfaced via actionError). `deleteRemoteVault` takes
  // an explicit org id, so deleting a non-active vault works without first
  // switching to it.
  const isActiveOwner =
    members.find((m) => m.userId === session?.user.id)?.role === "owner";
  const canDelete = (orgId: string) =>
    orgId === activeOrgId ? isActiveOwner : true;
  // Same uncertainty, mirrored: on the active row Leave is for non-owners
  // only; elsewhere both are offered and the server's 409 settles it.
  const canLeave = (orgId: string) =>
    orgId === activeOrgId ? !isActiveOwner : true;

  const folderName = (orgId: string): string | null => {
    const p = bound[orgId];
    return p ? (p.split("/").pop() ?? p) : null;
  };

  // The org whose folder is actually open now — the true "Current", vs. merely
  // the account's active org (you can be viewing a local folder with sync off).
  const openPath = vault?.path ?? null;
  const isOpenOrg = (orgId: string) => openPath != null && bound[orgId] === openPath;

  const switchTo = async (orgId: string) => {
    if (busy || isOpenOrg(orgId)) return;
    setBusy(true);
    try {
      await useStore.getState().setActiveOrganization(orgId);
      setBound(readOrgVaults());
    } finally {
      setBusy(false);
    }
  };

  const switchToLocal = async (path: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await useStore.getState().openLocalVault(path);
      setBound(readOrgVaults());
    } finally {
      setBusy(false);
    }
  };

  // Detach a vault from this device only (server data untouched).
  const removeLocal = async (orgId: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await useStore.getState().removeVaultLocally(orgId);
      setBound(readOrgVaults());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ask before deleting. A vault that is actually paying gets the full
   * ConfirmDialog, because "Delete everything?" cannot say the one thing its
   * owner needs to know: the subscription stops at the END of the current
   * period, and until then it can be moved to another vault (#111). Every
   * other vault gets the plain ConfirmDialog below; nothing confirms inline,
   * so a card never changes shape while a confirm is pending.
   *
   * A billing lookup that fails is treated as free — an unreachable billing
   * endpoint must not block a delete the user is entitled to make.
   */
  const askDelete = async (orgId: string, name: string) => {
    setActionError(null);
    // Team model: the subscription is the owner's account, and deleting a
    // vault does not touch it, so there is no subscription to warn about.
    if (!billingEnabled || teamBilling) {
      setConfirmDelete({ orgId, name });
      return;
    }
    let billing: OrgBilling | null = null;
    try {
      billing = await authManager.api.getOrgBilling(orgId);
    } catch {
      billing = null;
    }
    if (billing && (billing.status === "active" || billing.status === "past_due")) {
      setSubDelete({ orgId, name, billing });
    } else {
      setConfirmDelete({ orgId, name });
    }
  };

  // Permanently delete a vault everywhere (owner only, confirmed above).
  const deletePermanently = async (orgId: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await useStore.getState().deleteRemoteVault(orgId);
      setBound(readOrgVaults());
      setConfirmDelete(null);
      setSubDelete(null);
      if (result.subscription && !teamBilling) {
        // Neutral, not success: the vault is gone, but the user is still paying
        // for the rest of the period and that time is recoverable.
        const ends = result.subscription.currentPeriodEnd;
        toast(
          ends
            ? `볼트를 삭제했어요. Pro는 ${formatDate(ends)}에 종료돼요. 유지하려면 결제에서 다른 볼트로 옮기세요.`
            : "볼트를 삭제했어요. Pro는 현재 결제 기간이 끝나면 종료돼요. 유지하려면 결제에서 다른 볼트로 옮기세요.",
          "neutral",
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Covers the 502 `subscription_cancel_failed` case: the server's message
      // rides `ApiError.message`, and NOTHING was deleted. The dialog stays
      // open (only success clears it) so the error has somewhere to show.
      setActionError(message);
      // Destructive path: a failure here must never look like a success (#85).
      // The cancel-failed message is already a full sentence (#300).
      const cancelFailed =
        e instanceof ApiError && (e.body as { error?: unknown } | undefined)?.error === "subscription_cancel_failed";
      toast(cancelFailed ? message : `볼트를 삭제하지 못했어요: ${message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Leave a vault someone else owns (confirmed above). Server first, then the
  // vault leaves this device entirely; the dialog stays open on failure so the
  // server's reason (an owner's 409, offline) has somewhere to show.
  const leaveVault = async (orgId: string, _name: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await useStore.getState().leaveVault(orgId);
      setBound(readOrgVaults());
      setConfirmLeave(null);
      // The store shows the one "You left <vault>" notice after the cleanup.
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setActionError(message);
      toast(`볼트에서 나가지 못했어요: ${message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Forget a local vault from this device's list (files on disk are kept).
  const removeLocalVaultRow = async (path: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await useStore.getState().removeLocalVault(path);
      setLocalsNonce((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A local folder's ⋯ actions, shared by its list row and its grid card.
  const localActions = (path: string, name: string): RowAction[] => [
    {
      key: "remove",
      label: "목록에서 제거",
      title: "이 폴더를 목록에서 제거해요. 파일은 디스크에 그대로 남아요.",
      onSelect: () => removeLocalVaultRow(path),
    },
    {
      key: "delete",
      label: "볼트 삭제",
      danger: true,
      separated: true,
      title: "이 볼트를 삭제해요: 폴더와 모든 노트를 휴지통으로 옮겨요",
      onSelect: () => {
        setActionError(null);
        setConfirmDeleteLocal({ path, name });
      },
    },
  ];

  // Move a local vault's folder to the OS trash (destructive, confirmed in a dialog).
  const deleteLocalFiles = async (path: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await useStore.getState().deleteLocalVault(path);
      setConfirmDeleteLocal(null);
      setLocalsNonce((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createOrg = async () => {
    if (!orgName.trim()) return;
    setBusy(true);
    setActionError(null);
    setLimitNudge(null);
    try {
      await useStore.getState().createOrganization(orgName.trim());
      setOrgName("");
      setCreating(false);
      setBound(readOrgVaults());
    } catch (e) {
      // A 402 vault-cap rejection becomes an upgrade nudge; anything else is
      // a real error (previously swallowed silently — that was the create bug).
      const kind = classifyLimitError(e);
      if (kind) setLimitNudge({ kind, limit: limitFromError(e) });
      else setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    setJoinError(null);
    try {
      await useStore.getState().joinVault(joinCode);
      setJoinCode("");
      setJoining(false);
      setBound(readOrgVaults());
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openExisting = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      // Pick only. `openLocalVault` retires the current sync scope before Rust
      // swaps its one global vault slot; `pickVault` opens during the dialog and
      // cannot provide that ordering guarantee.
      const path = await ipc.pickFolder();
      if (path) await useStore.getState().openLocalVault(path);
      setBound(readOrgVaults());
      setLocalsNonce((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Restore here / Locate folder… for the open vault whose folder is missing —
  // the same store actions as the banner and the Set-up prompt.
  const recover = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setBound(readOrgVaults());
      setLocalsNonce((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Both go through Rust's refusal of the home folder, its parents and the
  // top of the disk; a refusal (or a blocked Documents) is shown as a toast.
  const changeRoot = async () => {
    try {
      const picked = await ipc.pickVaultsRoot();
      if (picked) {
        setRoot(picked);
        setRootError(null);
      }
    } catch (e) {
      toast(folderErrorText(e), "error");
    }
  };
  const resetRoot = async () => {
    try {
      setRoot(await ipc.resetVaultsRoot());
      setRootError(null);
    } catch (e) {
      const text = folderErrorText(e);
      setRootError(text);
      toast(text, "error");
    }
  };

  // The ⋯ menu of a synced vault, shared by its row and its card.
  const syncedActions = (o: { id: string; name: string }, isActive: boolean): RowAction[] => [
    {
      key: "remove",
      label: "이 기기에서 제거",
      title: "이 기기에서 볼트 동기화를 멈춰요. 서버 데이터는 그대로 남아요",
      onSelect: () => removeLocal(o.id),
    },
    // Only the open synced vault, and only while its folder is
    // there (a missing one has Restore here beside the menu).
    ...(isActive && reset.available
      ? [{
          key: "reset",
          label: "로컬 사본 초기화",
          title: "이 기기의 볼트 사본을 삭제하고 새로 내려받아요",
          onSelect: reset.start,
        }]
      : []),
    ...(canLeave(o.id)
      ? [{
          key: "leave",
          label: "볼트 나가기",
          danger: true,
          separated: true,
          title: "이 볼트에서 나가요. 접근 권한을 잃고 이 기기에서도 제거돼요",
          onSelect: () => {
            setActionError(null);
            setConfirmLeave({ orgId: o.id, name: o.name });
          },
        }]
      : []),
    // Same owner heuristic as Delete: on the active row we know
    // the caller's role, elsewhere we don't, so we offer it and
    // let the server's 403 `owner_only` settle it.
    ...(canDelete(o.id)
      ? [
          {
            key: "unsync",
            label: "이 기기에만 두기",
            danger: true,
            separated: !canLeave(o.id),
            title: "서버에서 이 볼트를 삭제하고 파일은 이 기기에 남겨 둬요",
            onSelect: () => {
              setActionError(null);
              setConfirmUnsync({ orgId: o.id, name: o.name });
            },
          },
          {
            key: "delete",
            label: "볼트 삭제",
            danger: true,
            title: "이 볼트와 모든 노트를 모두에게서 영구 삭제해요",
            onSelect: () => askDelete(o.id, o.name),
          },
        ]
      : []),
  ];

  // A confirm dialog that is open shows the action's error itself; the page's
  // banner would only repeat it behind the dialog.
  const errorInDialog = !!(confirmDelete || confirmDeleteLocal || confirmLeave || subDelete);

  // Active vault pinned to the top.
  const ordered = [
    ...organizations.filter((o) => o.id === activeOrgId),
    ...organizations.filter((o) => o.id !== activeOrgId),
  ];

  // Owner rule 2026-10-07: this list shows only folders never synced to
  // 마브 (`visibleFolders`). A folder stamped for a vault this account is a
  // member of is that vault's synced row already; one stamped for any other
  // vault is hidden (signed out: every stamped folder). Nothing renders until
  // EVERY folder's stamp has settled, so other accounts' vaults never flash.
  const localsShown = foldersResolved ? visibleFolders(locals, folderClasses) : [];
  // Counted only when signed in: signed out there is no "other" account.
  const hiddenForeign =
    session && foldersResolved
      ? locals.filter((r) => folderClasses.get(r.path) === "foreign").length
      : 0;
  const foreignFootnote = hiddenForeignFootnote(hiddenForeign);
  const localsOrdered = [
    ...localsShown.filter((r) => !syncEnabled && vault?.path === r.path),
    ...localsShown.filter((r) => !(!syncEnabled && vault?.path === r.path)),
  ];

  const scopeSwitch = (
    <span className="vaults-scope" role="tablist" aria-label="볼트 범위">
      <button
        type="button"
        role="tab"
        aria-selected={scope === "synced"}
        className={scope === "synced" ? "is-on" : undefined}
        onClick={() => setScope("synced")}
      >
        동기화됨 <b>{organizations.length}</b>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={scope === "local"}
        className={scope === "local" ? "is-on" : undefined}
        onClick={() => setScope("local")}
      >
        이 기기 <b>{localsOrdered.length}</b>
      </button>
    </span>
  );

  // The open vault page, when a card was clicked and the vault still exists.
  const pageOrg = session && pageOrgId ? organizations.find((o) => o.id === pageOrgId) ?? null : null;
  const renderPage = (o: (typeof organizations)[number], withBack = true) => {
    const isActive = isOpenOrg(o.id);
    const usage = usageFor(o.id);
    const onMyAccount = !!usage;
    const activeMembers = o.id === activeOrgId ? members : [];
    const role = vaultPageRole({
      activeRole: activeMembers.find((m) => m.userId === session?.user.id)?.role ?? null,
      onMyAccount,
    });
    const ownerName = activeMembers.find((m) => m.role === "owner")?.user?.name || null;
    const planLine = usageShown
      ? vaultPagePlanLine({ onMyAccount, accountPlan: billing?.account.plan ?? null, ownerName })
      : null;
    const settingsAction = vaultSettingsAction({ isOpen: isActive, boundPath: bound[o.id] ?? null });
    return (
      <AccountVaultPage
        orgId={o.id}
        name={o.name}
        slug={vaultSlugLabel(o)}
        isCurrent={isActive}
        lapsed={!!usage && accountLapsed}
        busy={busy}
        showStats={usageShown}
        usage={usage}
        usageLoading={billingLoading}
        details={vaultPageDetails({
          role,
          planLine,
          folderPath: bound[o.id] ?? null,
          createdAt: o.createdAt,
          formatDate,
        })}
        actions={syncedActions(o, isActive)}
        folderMissing={
          isActive && rootMissing ? (
            <VaultFolderMissingRowActions
              synced={syncEnabled}
              busy={busy}
              onRestore={recover(() => useStore.getState().restoreVaultFolder())}
              onLocate={recover(() => useStore.getState().locateVaultFolder())}
            />
          ) : null
        }
        settingsAction={settingsAction}
        onSwitch={() => switchTo(o.id)}
        onOpenSettings={async () => {
          // The Plan tab's invited-chip rule: switch first when needed, then
          // Vault Settings → Members and access.
          if (settingsAction === "unavailable") return;
          if (settingsAction === "switch-then-open") {
            await switchTo(o.id);
            if (useStore.getState().session?.activeOrganizationId !== o.id) return;
          }
          useStore.getState().requestSettings("members");
        }}
        onBack={withBack ? () => setPageOrgId(null) : undefined}
      />
    );
  };

  return (
    <>
      {pageOrg ? (
        <>
          {renderPage(pageOrg)}
          {actionError && !errorInDialog && <div className="auth-error">{actionError}</div>}
        </>
      ) : (
        <>
      {session && userInvitations.length > 0 && (
        <>
          <div className="subhead">초대 ({userInvitations.length})</div>
          <div className="account-vaults-invites">
            <InvitationRows invitations={userInvitations} freshIds={freshInviteIds} />
          </div>
          <div className="menu-sep" />
        </>
      )}
      {session && scope === "synced" && (
        <>
      <div className="subhead account-vaults-head">
        {scopeSwitch}
        <span className="account-vaults-head-actions">
          {!creating && !joining && (
          <>
            <button
              type="button"
              className="primary vault-hdr-btn"
              onClick={() => setCreating(true)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>새 볼트</span>
            </button>
            <button
              type="button"
              className="secondary vault-hdr-btn"
              onClick={() => setJoining(true)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
              </svg>
              <span>참여 코드로 가입</span>
            </button>
          </>
          )}
          {/* The form opens where its button was, so nothing else moves. */}
        {(creating || joining) && (
          <div className="vault-tab-actions">
            {creating ? (
              <form
                className="vault-tab-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createOrg();
                }}
              >
                <input
                  autoFocus
                  placeholder="볼트 이름"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setCreating(false);
                  }}
                />
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !orgName.trim()}
                >
                  만들기
                </button>
                <button
                  type="button"
                  className="ghost-pill"
                  disabled={busy}
                  onClick={() => setCreating(false)}
                >
                  취소
                </button>
              </form>
            ) : joining ? (
              <form
                className="vault-tab-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void joinByCode();
                }}
              >
                <input
                  autoFocus
                  className="vault-tab-code"
                  placeholder="참여 코드 (예: K7MPX2RA)"
                  value={joinCode}
                  spellCheck={false}
                  autoCapitalize="characters"
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setJoining(false);
                  }}
                />
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !joinCode.trim()}
                >
                  참여
                </button>
                <button
                  type="button"
                  className="ghost-pill"
                  disabled={busy}
                  onClick={() => setJoining(false)}
                >
                  취소
                </button>
              </form>
            ) : null}
          </div>
        )}
        </span>
      </div>
      {/* Split view: the vault list on the left, the selected vault's page on
          the right (its role, plan, folder, usage and actions). Opens on the
          vault you are in. */}
      <div className="vaults-split">
        <div className="vaults-split-list">
          <input
            className="vaults-search"
            type="search"
            placeholder="볼트 검색"
            aria-label="볼트 검색"
            value={vaultQuery}
            onChange={(e) => setVaultQuery(e.target.value)}
          />
          <ul className="vaults-split-items" role="listbox" aria-label="동기화된 볼트">
            {ordered
              .filter((o) => !vaultQuery.trim() || o.name.toLowerCase().includes(vaultQuery.trim().toLowerCase()))
              .map((o) => {
                const isActive = isOpenOrg(o.id);
                const labels = vaultCardLabels(o, usageFor(o.id), {
                  folderMissing: isActive && rootMissing,
                });
                const selected = (selectedOrgId ?? ordered[0]?.id) === o.id;
                return (
                  <li
                    key={o.id}
                    role="option"
                    aria-selected={selected}
                    tabIndex={0}
                    className={`vaults-split-item${selected ? " selected" : ""}`}
                    onClick={() => setSelectedOrgId(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedOrgId(o.id);
                      }
                    }}
                  >
                    <VaultTile identity={`org:${o.id}`} name={o.name} />
                    <span className="vaults-split-text">
                      <span className="vaults-split-name" title={labels.name}>{labels.name}</span>
                      <span className={`vaults-split-meta${labels.metaDanger ? " is-danger" : ""}`}>
                        {labels.meta ?? ""}
                      </span>
                    </span>
                    {isActive && <span className="vaults-split-open">열려 있음</span>}
                  </li>
                );
              })}
          </ul>
        </div>
        <div className="vaults-split-detail">
          {(() => {
            const sel = ordered.find((o) => o.id === (selectedOrgId ?? ordered[0]?.id));
            return sel ? renderPage(sel, false) : <p className="muted">아직 동기화된 볼트가 없어요.</p>;
          })()}
        </div>
      </div>
      {freeVaultLimit != null && (
        <p className="muted">
          무료 플랜은 계정당 동기화 볼트 {freeVaultLimit}개를 포함해요
          {baseFreeVaults != null && freeVaultLimit > baseFreeVaults
            ? " (이전에 쓰던 볼트 포함)"
            : ""}
          .
        </p>
      )}
      {joinError && <div className="auth-error">{joinError}</div>}
      {actionError && !errorInDialog && <div className="auth-error">{actionError}</div>}
      {limitNudge && (
        <LimitNudge
          kind={limitNudge.kind}
          limit={limitNudge.limit}
          onUpgrade={() => setUpgradeOpen(true)}
        />
      )}
        </>
      )}

      {(localsOrdered.length > 0 || session) && (!session || scope === "local") && (
        <>
          <div className="subhead account-vaults-head">
            {session ? scopeSwitch : <span>이 컴퓨터의 로컬 폴더 ({localsOrdered.length})</span>}
            {session && (
              <span className="account-vaults-head-actions">
                <AsyncButton
                  className="secondary vault-hdr-btn"
                  disabled={busy}
                  onClick={openExisting}
                >
                  <span>기존 폴더 열기</span>
                </AsyncButton>
              </span>
            )}
          </div>
          {localsOrdered.length === 0 ? (
            <div className="vaults-local-empty">
              <b>아직 로컬 폴더가 없어요</b>
              <span>이 컴퓨터에서 동기화 없이 연 폴더가 여기에 표시돼요.</span>
            </div>
          ) : (
            <ul className="vaults-split-items vaults-local-list" aria-label="이 컴퓨터의 로컬 폴더">
              {localsOrdered.map((r) => {
                const isCurrent = !syncEnabled && vault?.path === r.path;
                const labels = localCardLabels(r);
                return (
                  <li key={r.path} className={`vaults-split-item${isCurrent ? " selected" : ""}`} title={r.path}>
                    <span className="menu-swatch vault-grid-letter" aria-hidden="true">
                      {labels.letter}
                    </span>
                    <span className="vaults-split-text">
                      <span className="vaults-split-name">{labels.name}</span>
                      <span className="vaults-split-meta">{r.path}</span>
                    </span>
                    {isCurrent && rootMissing ? (
                      <VaultFolderMissingRowActions
                        synced={false}
                        busy={busy}
                        onRestore={() => undefined}
                        onLocate={recover(() => useStore.getState().locateVaultFolder())}
                      />
                    ) : isCurrent ? (
                      <span className="vaults-split-open">열려 있음</span>
                    ) : (
                      <AsyncButton
                        className="vault-switch-chip"
                        disabled={busy}
                        onClick={() => switchToLocal(r.path)}
                      >
                        여기서 열기
                      </AsyncButton>
                    )}
                    <RowActionsMenu
                      ariaLabel={`${r.name ?? r.path} 추가 작업`}
                      disabled={busy}
                      actions={localActions(r.path, r.name ?? r.path)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {foreignFootnote && <p className="muted account-vaults-footnote">{foreignFootnote}</p>}
        </>
      )}

      {session && (
        <>
          <div className="menu-sep" />
          <div className="subhead">볼트 폴더 위치</div>
          <div className="join-code-row">
            <code className="vault-root-path" title={root ?? rootError ?? ""}>
              {root ?? (rootError ? "사용할 수 없음" : "…")}
            </code>
            <span
              className="account-vaults-info"
              role="img"
              aria-label={CURRENT_LINK_TIP}
              title={CURRENT_LINK_TIP}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </span>
            <button className="link-btn" onClick={() => void changeRoot()}>
              변경…
            </button>
            <button className="link-btn" onClick={() => void resetRoot()}>
              기본값으로 되돌리기
            </button>
          </div>
          <div className="muted">새 볼트는 이 폴더 안에 만들어져요.</div>
          {rootError && <p className="error">{rootError}</p>}
        </>
      )}

        </>
      )}
      {reset.dialog}

      {upgradeOpen && <UpgradeDialog onClose={() => setUpgradeOpen(false)} />}

      {confirmLeave && (
        <ConfirmDialog
          title={`${confirmLeave.name} 볼트에서 나갈까요?`}
          confirmLabel="볼트 나가기"
          onCancel={() => setConfirmLeave(null)}
          onConfirm={() => leaveVault(confirmLeave.orgId, confirmLeave.name)}
        >
          <p>
            모든 기기에서 이 볼트에 바로 접근할 수 없게 되고, 소유자에게 나갔다는 알림이
            가요.
          </p>
          <p>
            {bound[confirmLeave.orgId] ? (
              <>
                이 기기의 볼트 폴더 <strong>{folderName(confirmLeave.orgId)}</strong>는 아직
                동기화되지 않은 변경 사항까지 포함해 영구 삭제돼요. 휴지통으로 이동하지
                않아요.
              </>
            ) : (
              "이 기기에는 이 볼트의 데이터가 저장돼 있지 않아요."
            )}{" "}
            볼트 자체와 다른 멤버의 권한은 그대로예요.
          </p>
          <p>나중에 다시 들어오려면 새 초대나 참여 코드가 필요해요.</p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}

      {confirmUnsync && (
        <UnsyncConfirmDialog
          orgId={confirmUnsync.orgId}
          orgName={confirmUnsync.name}
          folderName={folderName(confirmUnsync.orgId)}
          onCancel={() => setConfirmUnsync(null)}
          onDone={() => {
            setConfirmUnsync(null);
            setBound(readOrgVaults());
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`${confirmDelete.name} 볼트를 삭제할까요?`}
          confirmLabel="볼트 삭제"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deletePermanently(confirmDelete.orgId)}
        >
          <p>
            이 볼트의 모든 노트, 폴더, 첨부 파일이 모두에게서 삭제되고, 이 기기의 폴더는
            휴지통으로 이동해요. 되돌릴 수 없어요.
          </p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}

      {confirmDeleteLocal && (
        <ConfirmDialog
          title={`${confirmDeleteLocal.name} 볼트를 삭제할까요?`}
          confirmLabel="볼트 삭제"
          onCancel={() => setConfirmDeleteLocal(null)}
          onConfirm={() => deleteLocalFiles(confirmDeleteLocal.path)}
        >
          <p>이 볼트의 폴더와 모든 노트가 휴지통으로 이동해요.</p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}

      {subDelete && (
        <ConfirmDialog
          title={`${subDelete.name} 볼트를 삭제할까요?`}
          confirmLabel="볼트 삭제"
          onCancel={() => setSubDelete(null)}
          onConfirm={() => deletePermanently(subDelete.orgId)}
        >
          <p>
            이 볼트는 <strong>Pro</strong> 플랜이에요
            {subDelete.billing.currentPeriodEnd
              ? subDelete.billing.cancelAtPeriodEnd
                ? `. ${formatDate(subDelete.billing.currentPeriodEnd)}에 종료 예정`
                : `. ${formatDate(subDelete.billing.currentPeriodEnd)}에 갱신 예정`
              : ""}
          </p>
          <p>
            삭제하면 현재 결제 기간이 끝날 때 구독이 중단돼요. 이후에는 요금이 청구되지
            않고, 그때까지는 <strong>결제</strong>에서 구독을 다른 볼트로 옮길 수 있어요.
          </p>
          <p>
            이 볼트의 모든 노트, 폴더, 첨부 파일이 모두에게서 삭제되고, 이 기기의 폴더는
            휴지통으로 이동해요. 이 부분은 되돌릴 수 없어요.
          </p>
          {actionError && <div className="auth-error">{actionError}</div>}
        </ConfirmDialog>
      )}
    </>
  );
}


