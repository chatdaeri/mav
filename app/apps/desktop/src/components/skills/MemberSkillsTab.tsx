// A member profile's "Skills" tab (owners/admins): this person's level for
// every team skill, from their own row or the Everyone row, changed in place
// with the same menu as a skill's Shared with tab.

import { useCallback, useEffect, useState } from "react";
import { authManager } from "../../lib/auth/authManager";
import { ACCESS_LABEL, accessLevelClass, personAccessOptions, type PersonAccessChoice } from "../../lib/skills/access";
import { skillDisplayName } from "../../lib/skills/display";
import { loadErrorText, withTimeout } from "../../lib/skills/loading";
import { checkSkillsNow, useSkillsChanged } from "../../lib/skills/syncHost";
import type { MemberSkillAccess, SkillAccessLevel } from "../../lib/skills/types";
import { toast } from "../../lib/toast";
import { ConfirmDialog } from "../ConfirmDialog";
import { MenuSelect } from "../MenuSelect";
import { LoadError } from "./parts";
import "./skills.css";

export function MemberSkillsTab({ orgId, userId, name }: { orgId: string; userId: string; name: string }) {
  const [skills, setSkills] = useState<MemberSkillAccess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<MemberSkillAccess | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await withTimeout(authManager.api.getMemberSkills(orgId, userId)));
      setError(null);
    } catch (e) {
      setError(loadErrorText(e));
    }
  }, [orgId, userId]);
  useEffect(() => {
    void load();
  }, [load]);
  useSkillsChanged(orgId, () => void load());

  /** `level: null` = back to the Everyone row. */
  const apply = async (s: MemberSkillAccess, level: SkillAccessLevel | null) => {
    setBusy(true);
    try {
      const out = await authManager.api.putSkillAccess(orgId, s.skillId, { people: [{ userId, level }] });
      const now = out.people.find((p) => p.userId === userId)?.level ?? "none";
      toast(
        now === "none"
          ? `${name}님은 이제 ${skillDisplayName(s.name)}을(를) 받지 않아요.`
          : `${name}님이 이제 ${skillDisplayName(s.name)}을(를) ${ACCESS_LABEL[now]} 권한으로 받아요.`,
      );
      checkSkillsNow();
      await load();
    } catch (e) {
      toast(`${name}님의 ${skillDisplayName(s.name)}을(를) 바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (error && !skills) return <LoadError message={`${name}님의 스킬을 불러오지 못했어요: ${error}`} onRetry={() => void load()} />;
  if (!skills) return <div className="skills-access-skel" aria-busy="true" aria-label={`${name}님의 스킬 불러오는 중`} />;
  if (skills.length === 0) return <div className="muted skills-quiet">이 볼트에는 아직 팀 스킬이 없어요.</div>;

  return (
    <div className="skills-access">
      <p className="field-hint skills-access-note">
        이 볼트에서 {name}님의 AI 도구가 받는 스킬이에요. 개별 설정이 모든 멤버 기본값보다 우선해요.
      </p>
      <ul className="skills-access-people">
        {skills.map((s) => {
          return (
            <li key={s.skillId} className="skills-access-person">
              <span className="members-table-names">
                <span className="members-table-name">{skillDisplayName(s.name)}</span>
                <span className="muted">
                  {s.latestVersion === null ? "게시 안 됨 · " : ""}
                  {s.own ? "개별 설정" : "모든 멤버와 동일"}
                </span>
              </span>
              <MenuSelect<PersonAccessChoice>
                value={s.level}
                options={personAccessOptions(s.own, s.everyone)}
                onSelect={(c) => {
                  if (c === "everyone") return void apply(s, null);
                  if (!s.own && c === s.level) return;
                  if (c === "none") setConfirm(s);
                  else void apply(s, c);
                }}
                disabled={busy}
                ariaLabel={`${name}님의 ${skillDisplayName(s.name)}`}
                triggerClassName={`members-access-trigger is-level ${accessLevelClass(s.level)}`}
                menuClassName="access-menu"
                triggerContent={ACCESS_LABEL[s.level]}
              />
            </li>
          );
        })}
      </ul>

      {confirm && (
        <ConfirmDialog
          title={`${name}님의 ${skillDisplayName(confirm.name)} 권한을 제거할까요?`}
          confirmLabel="제거"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const s = confirm;
            setConfirm(null);
            await apply(s, "none");
          }}
        >
          어디서도 이 스킬이 보이지 않고, AI 도구에서도 사라져요. 수정하지 않은 사본은 컴퓨터에서 삭제되고,
          직접 수정한 사본은 본인의 스킬로 남아요.
        </ConfirmDialog>
      )}
    </div>
  );
}
