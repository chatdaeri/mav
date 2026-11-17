// Pure rules behind the "Members and access" page, kept out of the component
// so the wording and the narrowing rule can be pinned by tests.

import type {
  InvitationOverview,
  Member,
  InviteManyResult,
  MemberAccessLevel,
  MemberOverview,
  MembersOverview,
  TeamAccess,
  TeamAccessMode,
  TeamAccessPosture,
} from "./api";
import { relativeTime } from "./health/format";

/** The three wire modes in the page's words, for the Everyone row. */
export const EVERYONE_OPTIONS: ReadonlyArray<{ value: TeamAccessMode; label: string; hint: string }> = [
  { value: "open", label: "편집 가능", hint: "모든 노트를 읽고 수정할 수 있어요" },
  { value: "readonly", label: "보기 가능", hint: "읽기만 가능해요" },
  { value: "private", label: "접근 불가", hint: "변경하기 전에는 어떤 노트도 열 수 없어요" },
];

/** New members: what they get of notes made before they joined. */
export const NEW_MEMBER_OPTIONS: ReadonlyArray<{ value: TeamAccessMode; label: string; hint?: string }> = [
  { value: "open", label: "편집 가능" },
  { value: "readonly", label: "보기 가능" },
  { value: "private", label: "접근 불가", hint: "새 노트와 공유된 노트만 볼 수 있어요" },
];

/** A person's vault-wide level, as their row's dropdown offers it. */
export const PERSON_LEVEL_LABEL: Record<MemberAccessLevel, string> = {
  edit: "모두 편집 가능",
  view: "모두 보기 가능",
  none: "접근 불가",
  custom: "사용자 지정",
};

export const INVITE_ACCESS_LABEL: Record<TeamAccessMode, string> = {
  open: "모두 편집 가능",
  readonly: "모두 보기 가능",
  private: "접근 불가",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "멤버",
};

export const LEVEL_TO_MODE: Record<Exclude<MemberAccessLevel, "custom">, TeamAccessMode> = {
  edit: "open",
  view: "readonly",
  none: "private",
};


/**
 * Does this change ask for confirmation first? Only taking access away
 * entirely (to No access) does — that is the one change that removes content
 * from someone's devices. Making something view-only, or widening, applies
 * straight away. Every confirm on the Members and access surfaces uses this.
 */
export function needsAccessConfirm(from: TeamAccessMode | "custom" | null, to: TeamAccessMode): boolean {
  return to === "private" && from !== "private";
}

/** The Everyone row's label. A never-shared vault reads as No access, with a
 * sub-line explaining that authors keep their own notes. */
export function everyoneLabel(mode: TeamAccessMode, posture: TeamAccessPosture): { label: string; sub: string | null } {
  if (posture === "none") return { label: "접근 불가", sub: "멤버는 자신이 쓴 노트를 계속 볼 수 있어요" };
  const option = EVERYONE_OPTIONS.find((o) => o.value === mode);
  return { label: option?.label ?? "접근 불가", sub: null };
}

/** Case-insensitive name/email filter for the people table. */
export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export function filterPeople(
  query: string,
  members: readonly MemberOverview[],
  invitations: readonly InvitationOverview[],
): { members: MemberOverview[]; invitations: InvitationOverview[] } {
  return {
    members: members.filter((m) => matchesQuery(query, m.name, m.email)),
    invitations: invitations.filter((i) => matchesQuery(query, i.email)),
  };
}


/** "4 people · 1 invite pending", or "1 person found" while searching. */
export function countLine(query: string, people: number, invites: number): string {
  if (query.trim()) return `${people + invites}명 검색됨`;
  const base = `${people}명`;
  return invites > 0 ? `${base} · 초대 ${invites}건 대기 중` : base;
}

/**
 * Who is in the vault right now. The vault channel's presence lists OTHER
 * peers only, so the signed-in user counts as present whenever their own
 * vault channel is connected.
 */
export function presentUserIds(
  peers: ReadonlyArray<{ userId: string }>,
  selfId: string | null | undefined,
  vaultStatus: string,
): Set<string> {
  const ids = new Set(peers.map((p) => p.userId));
  if (selfId && (vaultStatus === "synced" || vaultStatus === "read-only")) ids.add(selfId);
  return ids;
}

/** Shown in the Last active column while a person is present. */
export const LAST_ACTIVE_NOW = "지금";

/** The Last active column: "now" when present on the vault channel. */
export function lastActiveLabel(present: boolean, lastActiveAt: string | null, now: number): string {
  if (present) return LAST_ACTIVE_NOW;
  if (!lastActiveAt) return "—";
  const ms = Date.parse(lastActiveAt);
  if (!Number.isFinite(ms)) return "—";
  if (now - ms < 45_000) return LAST_ACTIVE_NOW;
  return relativeTime(ms, now);
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Sep 12, 2026" — the profile's Joined and Last active rows. */
export function fullDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Sep 12, 2026 (3 days ago)" — the profile's Joined and Last active rows. */
export function dateWithAgo(iso: string | null, now: number): string {
  const date = fullDate(iso);
  if (!date) return "";
  const ms = Date.parse(iso!);
  const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const ago = ms < today && ms >= startOfDay(today - 1) ? "어제" : relativeTime(ms, now);
  return `${date} (${ago})`;
}

/** How a grant reads in the Activity tab, in the Access tab's own words. */
export const GRANT_LABEL: Record<"edit" | "view" | "readonly" | "denied" | "locked", string> = {
  edit: "편집 가능",
  view: "보기 가능",
  readonly: "보기 가능",
  denied: "접근 불가",
  locked: "보기 전용",
};

/** A note path's display name and its parent folders: "A/B/Note.md" → { name: "Note", folders: ["A", "B"] }. */
export function splitNotePath(path: string): { name: string; folders: string[] } {
  const parts = path.split("/").filter(Boolean);
  const file = parts.pop() ?? path;
  const dot = file.lastIndexOf(".");
  return { name: dot > 0 ? file.slice(0, dot) : file, folders: parts };
}

/** The Access column's static text for an invitation row. */
export function invitationAccessLabel(access: TeamAccessMode | null): string {
  return access ? INVITE_ACCESS_LABEL[access] : "기본값";
}

/** Split typed or pasted text into addresses on commas, whitespace and semicolons. */
export function splitEmails(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * What ticking "can open" on one folder or note grants a person: their own
 * vault-wide level when it is Can edit or Can view, else Everyone's level when
 * that is one of those, else Can edit. Never a silent default to view — that
 * read as the tick taking edit rights away.
 */
export function tickGrantMode(
  personVaultMode: TeamAccessMode | "custom" | null,
  everyoneMode: TeamAccessMode | null,
): TeamAccessMode {
  if (personVaultMode === "open" || personVaultMode === "readonly") return personVaultMode;
  if (everyoneMode === "open" || everyoneMode === "readonly") return everyoneMode;
  return "open";
}

/** What a confirm about taking access away is about. */
export type ReduceScope =
  | { kind: "item"; name: string }
  | { kind: "person"; name: string; self: boolean }
  | { kind: "everyone" };

/** Said when access is removed outright. */
export const REMOVAL_SENTENCE =
  "더 이상 읽을 수 없는 콘텐츠는 다음 동기화 때 상대방의 기기에서 삭제돼요. 서버에 있는 사본은 그대로 남으며, 권한을 다시 주면 복원할 수 있어요.";
const REMOVAL_SENTENCE_SELF =
  "더 이상 읽을 수 없는 콘텐츠는 다음 동기화 때 내 기기에서 삭제돼요. 서버에 있는 사본은 그대로 남으며, 권한을 다시 받으면 복원할 수 있어요.";

/**
 * Title, button and outcome sentence for a confirm that lowers access to
 * Can view or No access. Plain words that name the result — never "narrow",
 * never a bare "Apply".
 */
export function reduceAccessCopy(
  scope: ReduceScope,
  to: "readonly" | "private",
): { title: string; button: string; outcome: string } {
  const self = scope.kind === "person" && scope.self;
  const button = to === "private" ? "권한 제거" : "보기 전용으로 변경";
  const outcome = to === "private"
    ? (self ? REMOVAL_SENTENCE_SELF : REMOVAL_SENTENCE)
    : (self ? "계속 읽을 수는 있지만 더 이상 편집할 수 없어요." : "계속 읽을 수는 있지만 더 이상 편집할 수 없어요.");
  let title: string;
  if (scope.kind === "item") {
    title = to === "private" ? `“${scope.name}”의 권한을 제거할까요?` : `“${scope.name}”을(를) 보기 전용으로 바꿀까요?`;
  } else if (scope.kind === "person") {
    title = to === "private"
      ? (scope.self ? "이 볼트에 대한 내 권한을 제거할까요?" : `${scope.name}님의 이 볼트 권한을 제거할까요?`)
      : (scope.self ? "볼트 전체에서 나를 보기 전용으로 바꿀까요?" : `볼트 전체에서 ${scope.name}님을 보기 전용으로 바꿀까요?`);
  } else {
    title = to === "private" ? "모든 멤버를 접근 불가로 설정할까요?" : "모든 멤버에게 볼트를 보기 전용으로 바꿀까요?";
  }
  return { title, button, outcome };
}

/** The before/after line an access confirm shows (ConfirmDialog `change`). */
export function accessChangeFor(
  scope: ReduceScope,
  from: TeamAccessMode | "custom" | null,
  to: TeamAccessMode,
): { who: string; sub?: string; from: TeamAccessMode | "custom" | null; to: TeamAccessMode } {
  if (scope.kind === "everyone") return { who: "모든 멤버", sub: "모든 멤버의 기본값", from, to };
  if (scope.kind === "person") {
    return scope.self ? { who: "나", sub: scope.name, from, to } : { who: scope.name, from, to };
  }
  return { who: scope.name, from, to };
}

/** Colour class for a level pill: green edit, amber view, grey none, neutral mixed. */
export function levelClass(level: TeamAccessMode | MemberAccessLevel | "mixed" | null | undefined): string {
  switch (level) {
    case "open":
    case "edit":
      return "is-edit";
    case "readonly":
    case "view":
      return "is-view";
    case "private":
    case "none":
      return "is-none";
    case "mixed":
    case "custom":
      return "is-mixed";
    default:
      return "";
  }
}

// -- Roster patches after a write (#307) --
// Paint-only: the tab patches what it shows at once, then refreshes once from
// the server, which stays authoritative.

/** The person level a vault-wide write of `mode` sets. */
export function levelOfMode(mode: TeamAccessMode): MemberAccessLevel {
  return mode === "open" ? "edit" : mode === "readonly" ? "view" : "none";
}

/** The roster with one member's vault-wide level replaced. */
export function withMemberLevel(ov: MembersOverview, userId: string, level: MemberAccessLevel): MembersOverview {
  return {
    ...ov,
    members: ov.members.map((m) => (m.userId === userId && m.access ? { ...m, access: { level } } : m)),
  };
}

/** The Everyone row after `PUT team-access`: the mode, its posture, no org overrides left. */
export function patchedTeamAccess(t: TeamAccess, mode: TeamAccessMode): TeamAccess {
  const posture: TeamAccessPosture = mode === "open" ? "edit" : mode === "readonly" ? "view" : "sealed";
  return { ...t, mode, posture, overrides: [] };
}

/** The roster without a revoked invitation. */
export function withoutInvitation(ov: MembersOverview, invitationId: string): MembersOverview {
  return { ...ov, invitations: ov.invitations.filter((i) => i.id !== invitationId) };
}

/** The roster with the invitations a send just created (or renewed), newest first. */
export function withNewInvitations(
  ov: MembersOverview,
  results: readonly InviteManyResult[],
  sent: { role: string; access: TeamAccessMode | null },
  nowIso: string,
): MembersOverview {
  const added: InvitationOverview[] = results
    .filter((r): r is InviteManyResult & { invitationId: string } => !r.error && !!r.invitationId)
    .map((r) => ({
      id: r.invitationId,
      email: r.email,
      role: sent.role,
      status: "pending",
      createdAt: nowIso,
      expiresAt: null,
      access: sent.access,
    }));
  if (!added.length) return ov;
  const emails = new Set(added.map((i) => i.email.toLowerCase()));
  return { ...ov, invitations: [...added, ...ov.invitations.filter((i) => !emails.has(i.email.toLowerCase()))] };
}

/**
 * May a viewer with `viewerRole` change the ACCESS of a member with
 * `targetRole`? The one rule the UI asks, mirrored by the server's
 * `permissions/access-management.ts canManageMemberAccess`:
 *
 *   - owner: anyone, themselves included (their own row is the way back in
 *     after narrowing the whole vault);
 *   - admin: everyone except the owner (plain members, other admins and
 *     themselves) — decided 2026-10-09; role changes and removal keep the
 *     stricter matrix where an admin never touches another admin;
 *   - member: nobody.
 */
export function canManageMemberAccess(
  viewerRole: string | null | undefined,
  targetRole: string | null | undefined,
  isSelf: boolean,
): boolean {
  if (viewerRole === "owner") return true;
  if (viewerRole === "admin") return isSelf || targetRole === "member" || targetRole === "admin";
  return false;
}

/**
 * The signed-in viewer's role in this vault, from the FRESHEST authority.
 * The store's `members` list is read when the vault opens, so a promotion
 * made after that (an owner making someone admin) leaves it stale for the
 * rest of the session; the roster overview is re-read every time the tab
 * opens. Its own row wins, then the server's `canManage` (a manager row we
 * somehow lack still means owner/admin), then the store's role.
 */
export function freshViewerRole(
  overview: Pick<MembersOverview, "members" | "canManage"> | null | undefined,
  myUserId: string | undefined,
  storedRole: string | undefined,
): string | undefined {
  const mine = overview && myUserId ? overview.members.find((m) => m.userId === myUserId)?.role : undefined;
  if (mine) return mine;
  if (overview && !overview.canManage && (storedRole === "owner" || storedRole === "admin")) return "member";
  return storedRole;
}

/** May this role see the manager view (Everyone row, Invite, Access column)? */
export function roleManages(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The store's member list with the viewer's role in `orgId` set to `role`.
 * Returns the SAME array when nothing changes, so a caller can skip the
 * store write; adds the row when the store never learned it.
 */
export function withViewerRole(
  members: readonly Member[],
  orgId: string,
  userId: string,
  role: string,
  memberId?: string,
): Member[] {
  const i = members.findIndex((m) => m.organizationId === orgId && m.userId === userId);
  if (i >= 0) {
    if (members[i].role === role) return members as Member[];
    const next = members.slice();
    next[i] = { ...members[i], role };
    return next;
  }
  return [...members, { id: memberId ?? `${orgId}:${userId}`, organizationId: orgId, userId, role }];
}
