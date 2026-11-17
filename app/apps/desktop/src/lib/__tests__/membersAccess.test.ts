import { describe, expect, it } from "vitest";
import {
  countLine,
  everyoneLabel,
  filterPeople,
  invitationAccessLabel,
  needsAccessConfirm,
  isValidEmail,
  tickGrantMode,
  reduceAccessCopy,
  lastActiveLabel,
  splitEmails,
} from "../membersAccess";
import { relativeTime } from "../health/format";
import { addChips } from "../../components/InvitePeopleDialog";

describe("members and access rules", () => {
  it("only taking access away entirely asks for confirmation", () => {
    expect(needsAccessConfirm("open", "private")).toBe(true);
    expect(needsAccessConfirm("readonly", "private")).toBe(true);
    expect(needsAccessConfirm("custom", "private")).toBe(true);
    expect(needsAccessConfirm(null, "private")).toBe(true);
    // View-only and widening apply straight away.
    expect(needsAccessConfirm("open", "readonly")).toBe(false);
    expect(needsAccessConfirm(null, "readonly")).toBe(false);
    expect(needsAccessConfirm("private", "open")).toBe(false);
    // Already No access: nothing to confirm.
    expect(needsAccessConfirm("private", "private")).toBe(false);
  });

  it("a never-shared vault reads as No access and says authors keep their notes", () => {
    expect(everyoneLabel("private", "none")).toEqual({ label: "접근 불가", sub: "멤버는 자신이 쓴 노트를 계속 볼 수 있어요" });
    expect(everyoneLabel("open", "edit")).toEqual({ label: "편집 가능", sub: null });
  });

  it("filters by name or email and counts", () => {
    const members = [
      { userId: "a", memberId: "1", role: "owner" as const, name: "Ana Ruiz", email: "ana@team.com", image: null, joinedAt: null, lastActiveAt: null },
      { userId: "b", memberId: "2", role: "member" as const, name: "Lee", email: "lee@team.com", image: null, joinedAt: null, lastActiveAt: null },
    ];
    const invitations = [{ id: "i", email: "maya@team.com", role: "member", status: "pending", createdAt: null, expiresAt: null, access: null }];
    expect(filterPeople("ANA", members, invitations).members.map((m) => m.userId)).toEqual(["a"]);
    expect(filterPeople("maya", members, invitations).invitations).toHaveLength(1);
    expect(countLine("", 4, 1)).toBe("4명 · 초대 1건 대기 중");
    expect(countLine("", 1, 0)).toBe("1명");
    expect(countLine("x", 1, 0)).toBe("1명 검색됨");
    expect(invitationAccessLabel(null)).toBe("기본값");
  });

  it("last active prefers live presence", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(lastActiveLabel(true, null, now)).toBe("지금");
    expect(lastActiveLabel(false, null, now)).toBe("—");
    expect(lastActiveLabel(false, "2026-10-04T10:00:00Z", now)).toBe(relativeTime(Date.parse("2026-10-04T10:00:00Z"), now));
  });

  it("splits, de-duplicates and validates invite emails", () => {
    expect(splitEmails("a@x.io, b@x.io;c@x.io\nd@x.io")).toEqual(["a@x.io", "b@x.io", "c@x.io", "d@x.io"]);
    expect(addChips(["A@x.io"], "a@x.io b@x.io")).toEqual(["A@x.io", "b@x.io"]);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("ok@team.com")).toBe(true);
  });
});

import { canActOnMember, canSetMemberAccess } from "../../components/memberRoles";

describe("who may change a person's access", () => {
  const args = (myRole: string, target: { userId: string; role: string }) =>
    ({ canManage: true, myUserId: "me", myRole, target });
  it("owner: anyone, including themselves", () => {
    expect(canSetMemberAccess(args("owner", { userId: "me", role: "owner" }))).toBe(true);
    expect(canSetMemberAccess(args("owner", { userId: "a", role: "admin" }))).toBe(true);
    // Role change / remove are unchanged: never yourself.
    expect(canActOnMember(args("owner", { userId: "me", role: "owner" }))).toBe(false);
  });
  it("admin: everyone except the owner", () => {
    expect(canSetMemberAccess(args("admin", { userId: "me", role: "admin" }))).toBe(true);
    expect(canSetMemberAccess(args("admin", { userId: "m", role: "member" }))).toBe(true);
    expect(canSetMemberAccess(args("admin", { userId: "a", role: "admin" }))).toBe(true);
    // Role change / remove stay stricter: an admin never touches another admin.
    expect(canActOnMember(args("admin", { userId: "a", role: "admin" }))).toBe(false);
    expect(canSetMemberAccess(args("admin", { userId: "o", role: "owner" }))).toBe(false);
  });
  it("member or no manage right: nobody", () => {
    expect(canSetMemberAccess(args("member", { userId: "me", role: "member" }))).toBe(false);
    expect(canSetMemberAccess({ ...args("owner", { userId: "me", role: "owner" }), canManage: false })).toBe(false);
  });
});

describe("what a tick grants", () => {
  it("prefers the person's level, then Everyone's, then Can edit", () => {
    expect(tickGrantMode("readonly", "open")).toBe("readonly");
    expect(tickGrantMode("open", "readonly")).toBe("open");
    expect(tickGrantMode("custom", "readonly")).toBe("readonly");
    expect(tickGrantMode("private", "open")).toBe("open");
    expect(tickGrantMode(null, "private")).toBe("open");
    expect(tickGrantMode("custom", null)).toBe("open");
  });
});

describe("confirm copy for taking access away", () => {
  it("names the outcome in plain words", () => {
    expect(reduceAccessCopy({ kind: "item", name: "Specs" }, "private")).toMatchObject({ title: "“Specs”의 권한을 제거할까요?", button: "권한 제거" });
    expect(reduceAccessCopy({ kind: "item", name: "Specs" }, "readonly")).toEqual({
      title: "“Specs”을(를) 보기 전용으로 바꿀까요?", button: "보기 전용으로 변경", outcome: "계속 읽을 수는 있지만 더 이상 편집할 수 없어요.",
    });
    expect(reduceAccessCopy({ kind: "person", name: "Sara", self: false }, "private").title).toBe("Sara님의 이 볼트 권한을 제거할까요?");
    expect(reduceAccessCopy({ kind: "person", name: "Sara", self: false }, "readonly").title).toBe("볼트 전체에서 Sara님을 보기 전용으로 바꿀까요?");
    expect(reduceAccessCopy({ kind: "person", name: "Me", self: true }, "private")).toMatchObject({
      title: "이 볼트에 대한 내 권한을 제거할까요?", outcome: expect.stringContaining("내 기기에서 삭제돼요"),
    });
    expect(reduceAccessCopy({ kind: "everyone" }, "private").title).toBe("모든 멤버를 접근 불가로 설정할까요?");
    expect(reduceAccessCopy({ kind: "everyone" }, "readonly").title).toBe("모든 멤버에게 볼트를 보기 전용으로 바꿀까요?");
    for (const to of ["private", "readonly"] as const) {
      const c = reduceAccessCopy({ kind: "everyone" }, to);
      expect(`${c.title} ${c.button} ${c.outcome}`).not.toMatch(/narrow|apply/i);
    }
  });
});

describe("roster patches after a write (#307)", () => {
  it("patches one member's level, the Everyone row and invitations", async () => {
    const m = await import("../membersAccess");
    const ov = {
      members: [
        { userId: "a", access: { level: "edit" } },
        { userId: "b", access: { level: "edit" } },
      ],
      invitations: [{ id: "i1", email: "x@y.z", role: "member", status: "pending", createdAt: null, expiresAt: null, access: null }],
    } as unknown as Parameters<typeof m.withMemberLevel>[0];
    const next = m.withMemberLevel(ov, "b", m.levelOfMode("private"));
    expect(next.members.map((x) => x.access?.level)).toEqual(["edit", "none"]);
    expect(m.withoutInvitation(ov, "i1").invitations).toEqual([]);
    const inv = m.withNewInvitations(
      ov,
      [{ email: "X@y.z", invitationId: "i2", emailed: true }, { email: "bad@y.z", emailed: false, error: "no" }],
      { role: "admin", access: "readonly" },
      "2026-10-05T00:00:00.000Z",
    );
    expect(inv.invitations.map((i) => i.id)).toEqual(["i2"]);
    const t = m.patchedTeamAccess({ mode: "open", posture: "edit", grantId: "g", overrides: [{} as never] }, "readonly");
    expect(t).toMatchObject({ mode: "readonly", posture: "view", overrides: [] });
  });
});

import { freshViewerRole, roleManages, withViewerRole } from "../membersAccess";

describe("the viewer's role follows the freshest authority", () => {
  const row = (userId: string, role: "owner" | "admin" | "member") => ({
    userId, memberId: `m-${userId}`, role, name: null, email: null, image: null, joinedAt: null, lastActiveAt: null,
  });
  it("the overview's own row beats a role the store learned at launch", () => {
    const ov = { members: [row("o", "owner"), row("me", "admin")], canManage: true };
    expect(freshViewerRole(ov, "me", "member")).toBe("admin");
    expect(roleManages(freshViewerRole(ov, "me", "member"))).toBe(true);
  });
  it("a demotion wins too, and a missing row falls back to the server's canManage", () => {
    expect(freshViewerRole({ members: [row("me", "member")], canManage: false }, "me", "admin")).toBe("member");
    expect(freshViewerRole({ members: [], canManage: false }, "me", "admin")).toBe("member");
    expect(freshViewerRole({ members: [], canManage: true }, "me", "admin")).toBe("admin");
  });
  it("before the overview answers, the store's role stands", () => {
    expect(freshViewerRole(null, "me", "member")).toBe("member");
    expect(roleManages("member")).toBe(false);
    expect(roleManages(undefined)).toBe(false);
  });
  it("withViewerRole patches only the viewer's row and keeps identity when unchanged", () => {
    const list = [
      { id: "1", organizationId: "org", userId: "me", role: "member" },
      { id: "2", organizationId: "org", userId: "x", role: "owner" },
    ];
    const next = withViewerRole(list, "org", "me", "admin");
    expect(next).not.toBe(list);
    expect(next.map((m) => m.role)).toEqual(["admin", "owner"]);
    expect(withViewerRole(next, "org", "me", "admin")).toBe(next);
    expect(withViewerRole([], "org", "me", "admin", "m-me")).toEqual([
      { id: "m-me", organizationId: "org", userId: "me", role: "admin" },
    ]);
  });
});
