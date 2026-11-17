// A skill's "Shared with" tab (owners/admins): the Everyone row and every
// member's level, the same rows and pills as Members and access. A person's
// own level beats the Everyone row either way; "Same as everyone" drops it.
// Taking a skill away (No access) confirms first, like any access narrowing.

import { useCallback, useEffect, useState } from "react";
import { authManager } from "../../lib/auth/authManager";
import {
  ACCESS_LABEL,
  EVERYONE_ACCESS_OPTIONS,
  accessLevelClass,
  personAccessOptions,
  type PersonAccessChoice,
} from "../../lib/skills/access";
import { skillDisplayName } from "../../lib/skills/display";
import { loadErrorText, withTimeout } from "../../lib/skills/loading";
import { checkSkillsNow } from "../../lib/skills/syncHost";
import type { SkillAccessLevel, SkillAccessList } from "../../lib/skills/types";
import { toast } from "../../lib/toast";
import { useStore } from "../../store";
import { Avatar } from "../Avatar";
import { ConfirmDialog } from "../ConfirmDialog";
import { MenuSelect } from "../MenuSelect";
import { LoadError } from "./parts";

const ROLE_LABEL: Record<string, string> = { owner: "소유자", admin: "관리자", member: "멤버" };

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

type Pending =
  | { kind: "everyone"; level: SkillAccessLevel }
  | { kind: "person"; userId: string; name: string; level: SkillAccessLevel | null };

export function SkillSharedWith({
  orgId,
  skillId,
  skillName,
  onChanged,
}: {
  orgId: string;
  skillId: string;
  skillName: string;
  /** The audience changed: the page and grid reload their counts. */
  onChanged: () => void;
}) {
  const me = useStore((s) => s.session?.user.id ?? null);
  const [list, setList] = useState<SkillAccessList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const name = skillDisplayName(skillName);

  const load = useCallback(async () => {
    try {
      setList(await withTimeout(authManager.api.getSkillAccess(orgId, skillId)));
      setError(null);
    } catch (e) {
      setError(loadErrorText(e));
    }
  }, [orgId, skillId]);
  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (p: Pending) => {
    setBusy(true);
    try {
      const next = await authManager.api.putSkillAccess(
        orgId,
        skillId,
        p.kind === "everyone" ? { everyone: p.level } : { people: [{ userId: p.userId, level: p.level }] },
      );
      setList(next);
      onChanged();
      // This computer follows at once; everyone else's on the skills-changed frame.
      checkSkillsNow();
      if (p.kind === "person") {
        const level = next.people.find((x) => x.userId === p.userId)?.level ?? "none";
        toast(
          level === "none"
            ? `${p.name}님은 이제 ${name}을(를) 받지 않아요.`
            : `${p.name}님이 이제 ${name}을(를) ${ACCESS_LABEL[level]} 권한으로 받아요.`,
        );
      }
    } catch (e) {
      toast(`${name}을(를) 받는 사람을 바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  /** Narrowing to No access confirms; anything else applies at once. */
  const choose = (p: Pending) => {
    if (p.level === "none") setConfirm(p);
    else void apply(p);
  };

  if (error && !list) return <LoadError message={`${name}을(를) 받는 사람을 불러오지 못했어요: ${error}`} onRetry={() => void load()} />;
  if (!list) return <div className="skills-access-skel" aria-busy="true" aria-label="이 스킬을 받는 사람 불러오는 중" />;

  const having = list.people.filter((p) => p.level !== "none").length;
  const people = [...list.people].sort((a, b) => Number(b.own) - Number(a.own));

  return (
    <div className="skills-access">
      <div className="members-access-rows">
        <div className="members-access-row">
          <span className="members-access-row-icon" aria-hidden="true">
            <PeopleIcon />
          </span>
          <span className="members-access-row-copy">
            <span className="members-access-row-title">이 볼트의 모든 멤버</span>
            <span className="muted">아래에 개별 설정이 없는 모든 사람(새 멤버 포함)</span>
          </span>
          <MenuSelect
            value={list.everyone}
            options={EVERYONE_ACCESS_OPTIONS}
            onSelect={(level) => choose({ kind: "everyone", level })}
            disabled={busy}
            ariaLabel={`${name}을(를) 받는 사람: 모든 멤버`}
            triggerClassName={`members-access-trigger is-level ${accessLevelClass(list.everyone)}`}
            menuClassName="access-menu"
          />
        </div>
      </div>

      <div className="members-access-list-heading">
        <h3>멤버</h3>
        <span className="members-access-count muted">
          {list.people.length}명 중 {having}명이 사용 중
        </span>
      </div>
      <ul className="skills-access-people">
        {people.map((p) => {
          const label = p.name || p.email;
          return (
            <li key={p.userId} className="skills-access-person">
              <span className="members-table-person">
                <Avatar label={label} image={p.image} userId={p.userId} />
                <span className="members-table-names">
                  <span className="members-table-name">
                    {label}
                    {p.userId === me && <span className="muted"> (나)</span>}
                  </span>
                  <span className="muted">
                    {ROLE_LABEL[p.role] ?? p.role} · {p.own ? "개별 설정" : "모든 멤버와 동일"}
                  </span>
                </span>
              </span>
              <MenuSelect<PersonAccessChoice>
                value={p.level}
                options={personAccessOptions(p.own, list.everyone)}
                onSelect={(c) => {
                  const level = c === "everyone" ? null : c;
                  if (!p.own && level === p.level) return;
                  choose({ kind: "person", userId: p.userId, name: label, level });
                }}
                disabled={busy}
                ariaLabel={`${label}님의 ${name}`}
                triggerClassName={`members-access-trigger is-level ${accessLevelClass(p.level)}`}
                menuClassName="access-menu"
                triggerContent={ACCESS_LABEL[p.level]}
              />
            </li>
          );
        })}
      </ul>
      <p className="field-hint skills-access-note">
        소유자와 관리자는 관리를 위해 모든 스킬을 볼 수 있어요. 본인의 권한 수준에 따라 컴퓨터에 설치할지가 정해져요.
      </p>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "everyone" ? `모든 멤버에게서 ${name} 권한을 제거할까요?` : `${confirm.name}님의 ${name} 권한을 제거할까요?`}
          confirmLabel="제거"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const p = confirm;
            setConfirm(null);
            await apply(p);
          }}
        >
          {confirm.kind === "everyone"
            ? "개별 설정이 있는 사람만 계속 사용해요. "
            : "어디서도 이 스킬이 보이지 않고, AI 도구에서도 사라져요. "}
          수정하지 않은 사본은 컴퓨터에서 삭제되고, 직접 수정한 사본은 본인의 스킬로 남아요.
        </ConfirmDialog>
      )}
    </div>
  );
}
