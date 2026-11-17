/* Account Settings → Vaults → one vault's page: which stat tiles, detail rows
   and actions it shows, from what the Vaults tab already knows. Pure, so the
   choices are tested without React. */
import type { BillingUsageVault } from "./api";
import { formatBytes } from "./billing";

export interface VaultPageTile {
  key: "people" | "notes" | "attachments" | "files";
  caption: string;
  /** null while loading (skeleton) or when the vault is not in the usage (dash). */
  value: string | null;
  sub: string;
}

/**
 * Stat tiles in the Plan & Billing "Usage on this account" style. `usage`
 * is this vault's row of `GET /api/billing/account/usage`, or null when the
 * vault is not on the caller's account (or billing is off).
 */
export function vaultPageTiles(usage: BillingUsageVault | null): VaultPageTile[] {
  const [bytesValue, bytesUnit] = usage ? formatBytes(usage.storageBytes ?? 0).split(" ") : [];
  const tiles: VaultPageTile[] = [
    {
      key: "people",
      caption: "멤버",
      value: usage ? String(usage.people) : null,
      sub: "명",
    },
    {
      key: "notes",
      caption: "노트",
      value: usage ? String(usage.notes) : null,
      sub: "개",
    },
    {
      key: "attachments",
      caption: "첨부 파일",
      value: usage ? (bytesValue ?? "0") : null,
      sub: usage ? (bytesUnit ?? "B") : "저장됨",
    },
  ];
  if (usage && typeof usage.files === "number") {
    tiles.push({
      key: "files",
      caption: "파일",
      value: String(usage.files),
      sub: "개",
    });
  }
  return tiles;
}

export type VaultRole = "owner" | "admin" | "member";

export const ROLE_TEXT: Record<VaultRole, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
};

/**
 * The caller's role, from what is known: the active vault's member list
 * names it; a vault on the caller's own billing account is one they own;
 * anything else is unknown.
 */
export function vaultPageRole(input: {
  activeRole: string | null;
  onMyAccount: boolean;
}): VaultRole | null {
  const r = input.activeRole;
  if (r === "owner" || r === "admin" || r === "member") return r;
  return input.onMyAccount ? "owner" : null;
}

/** "On your Team account" / "On Sara's account" / "On the owner's account". */
export function vaultPagePlanLine(input: {
  onMyAccount: boolean;
  accountPlan: "free" | "team" | null;
  ownerName: string | null;
}): string {
  if (input.onMyAccount) {
    return input.accountPlan === "team"
      ? "내 팀 계정"
      : input.accountPlan === "free"
        ? "내 무료 계정"
        : "내 계정";
  }
  return input.ownerName ? `${input.ownerName}님의 계정` : "소유자의 계정";
}

export interface VaultPageDetail {
  key: "role" | "plan" | "folder" | "created";
  label: string;
  value: string;
}

export function vaultPageDetails(input: {
  role: VaultRole | null;
  /** null when billing is off: there is no account to name. */
  planLine: string | null;
  folderPath: string | null;
  createdAt: string | null | undefined;
  formatDate: (iso: string) => string;
}): VaultPageDetail[] {
  const rows: VaultPageDetail[] = [
    { key: "role", label: "내 역할", value: input.role ? ROLE_TEXT[input.role] : "—" },
  ];
  if (input.planLine) rows.push({ key: "plan", label: "플랜", value: input.planLine });
  rows.push({
    key: "folder",
    label: "이 기기의 폴더",
    value: input.folderPath ?? "이 기기에 없음",
  });
  if (input.createdAt && !Number.isNaN(Date.parse(input.createdAt))) {
    rows.push({ key: "created", label: "만든 날짜", value: input.formatDate(input.createdAt) });
  }
  return rows;
}

/**
 * "Open Vault Settings": the open vault opens straight away, a vault with a
 * folder here is switched to first, and one never opened on this device
 * cannot be (switching needs a folder), so the action is disabled with a hint.
 * The same rule as the Plan tab's invited-seat popover (`invitedVaultAction`).
 */
export function vaultSettingsAction(input: {
  isOpen: boolean;
  boundPath: string | null;
}): "open" | "switch-then-open" | "unavailable" {
  if (input.isOpen) return "open";
  return input.boundPath ? "switch-then-open" : "unavailable";
}

export const VAULT_SETTINGS_UNAVAILABLE_HINT =
  "먼저 이 볼트로 전환하세요. 이 기기에 아직 폴더가 없어요.";

/** Keep the menu's order, but every destructive action goes last. */
export function orderPageActions<T extends { danger?: boolean }>(actions: T[]): T[] {
  return [...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)];
}
