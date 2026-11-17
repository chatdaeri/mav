/**
 * Which empty state a vault with no visible content should show.
 *
 * `nothing-shared` is the member who joined under "New members: No access"
 * (owner decision 2026-10-09): their sidebar is empty because nothing is
 * shared with them, not because the vault is empty, and "press ⌘N" would be
 * refused at the root. Every input has to agree before we say so; any doubt
 * (signed out, local vault, channel not live, an older server that never
 * answered `hiddenContent`) falls back to `none`, the ordinary prompt.
 */
export type EmptyVaultState = "none" | "empty-vault" | "nothing-shared";

export interface EmptyVaultInput {
  signedIn: boolean;
  /** The open folder is a synced vault and a registry pull has answered. */
  synced: boolean;
  /** The vault channel is connected and converged. */
  live: boolean;
  /** Readable folders + notes in the last listing; null = no listing yet. */
  readableItems: number | null;
  /** Server: the vault holds content this user cannot read. null = not said. */
  hiddenContent: boolean | null;
  isOwner: boolean;
}

export function emptyVaultState(input: EmptyVaultInput): EmptyVaultState {
  if (!input.signedIn || !input.synced || !input.live) return "none";
  if (input.readableItems === null || input.readableItems > 0) return "none";
  if (input.hiddenContent === null) return "none";
  if (input.hiddenContent && !input.isOwner) return "nothing-shared";
  if (!input.hiddenContent) return "empty-vault";
  return "none";
}

export const NOTHING_SHARED_TITLE = "아직 공유된 항목이 없어요.";

export function nothingSharedBody(ownerName: string | null | undefined, vaultName: string | null | undefined): string {
  const owner = ownerName?.trim() || "소유자";
  const vault = vaultName?.trim() || "이 볼트";
  return `${owner}님이 ${vault}의 폴더나 노트에 대한 접근 권한을 아직 주지 않았어요. 공유해 달라고 요청해 보세요.`;
}

/** The editor's resting prompt; never mentions ⌘N when a root create would be refused. */
export function editorEmptyPrompt(canCreateRoot: boolean | null): string {
  return canCreateRoot === false ? "노트를 선택하세요." : "노트를 선택하거나 ⌘N을 눌러 새로 만드세요.";
}
