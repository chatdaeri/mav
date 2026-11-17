// Who gets a team skill (server migration 062, docs/SKILLS.md "Who gets a
// skill"): the Everyone row plus per-person levels, coloured like vault
// access (Required green, Optional amber, No access grey).

import type { SkillAccessLevel, SkillAudience, SkillSummary } from "./types";

/** `/health` feature: the server knows per-person skill access (migration 062). */
export const SKILL_ACCESS_FEATURE = "skill-access";

export const ACCESS_LABEL: Record<SkillAccessLevel, string> = {
  required: "필수",
  optional: "선택",
  none: "접근 불가",
};

export const EVERYONE_ACCESS_OPTIONS = [
  { value: "required" as const, label: "필수", hint: "모든 멤버에게 설치돼요" },
  { value: "optional" as const, label: "선택", hint: "각자 직접 켜요" },
  { value: "none" as const, label: "접근 불가", hint: "선택한 사람만 써요" },
];

/** A person's menu; "everyone" puts them back on the Everyone row. */
export type PersonAccessChoice = SkillAccessLevel | "everyone";
export function personAccessOptions(own: boolean, everyone: SkillAccessLevel) {
  return [
    { value: "required" as const, label: "필수", hint: "이 사람에게 설치돼요" },
    { value: "optional" as const, label: "선택", hint: "직접 켜요" },
    { value: "none" as const, label: "접근 불가", hint: "볼 수 없어요" },
    ...(own ? [{ value: "everyone" as const, label: `모든 멤버와 동일 (${ACCESS_LABEL[everyone]})` }] : []),
  ];
}

/** The vault access pill classes, so a skill level reads like an access level. */
export function accessLevelClass(level: SkillAccessLevel): string {
  return level === "required" ? "is-edit" : level === "optional" ? "is-view" : "is-none";
}

/** The skill's audience in a few words, for cards and the page header. */
export function audienceLine(a: SkillAudience, viewerIn: boolean): string {
  if (a.everyone) return `모든 멤버 · ${a.total}명`;
  if (a.count === 0) return "아직 없음";
  if (viewerIn) return a.count === 1 ? "나만" : `나 외 ${a.count - 1}명`;
  return `${a.count}명`;
}

/** What this person's computer gets: their own level, else (an old server) the delivery. */
export function myAccessOf(s: Pick<SkillSummary, "myAccess" | "delivery">): SkillAccessLevel {
  return s.myAccess ?? s.delivery;
}

/** The server knows per-person access (migration 062). */
export function hasSkillAccess(s: Pick<SkillSummary, "sharedWith">): boolean {
  return s.sharedWith !== undefined;
}
