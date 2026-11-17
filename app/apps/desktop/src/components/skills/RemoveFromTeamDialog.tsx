// "Remove from team": the server's soft delete of a team skill, from the skill
// page's ⋯ or a card's ⋯. It leaves every teammate's AI tools on their next
// check; nobody's own local folder (the original of a skill added from a
// computer) is touched.

import { useState } from "react";
import { authManager } from "../../lib/auth/authManager";
import { skillDisplayName } from "../../lib/skills/display";
import type { SkillSummary } from "../../lib/skills/types";
import { toast } from "../../lib/toast";
import { ConfirmDialog } from "../ConfirmDialog";

/** Did this skill come from someone's computer ("Added from …'s computer")? */
function fromAComputer(skill: SkillSummary & { versions?: { notes: string }[] }): boolean {
  return !skill.source && !!skill.versions?.some((v) => /^(Added|Shared) from .+ computer$/.test(v.notes));
}

export function RemoveFromTeamDialog({
  orgId,
  skill,
  onCancel,
  onRemoved,
  ownFolderHere = false,
}: {
  orgId: string;
  skill: SkillSummary & { versions?: { notes: string }[] };
  /** A folder of the same name on this computer that isn't a team copy (the original). */
  ownFolderHere?: boolean;
  onCancel: () => void;
  /** After the server removed it (the caller fades the card or leaves the page). */
  onRemoved: () => void;
}) {
  const name = skillDisplayName(skill.name);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      title={`팀에서 ${name}을(를) 제거할까요?`}
      confirmLabel={busy ? "제거하는 중…" : "팀에서 제거"}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        try {
          await authManager.api.deleteSkill(orgId, skill.id);
        } catch {
          setBusy(false);
          toast(`팀에서 ${name}을(를) 제거할 수 없어요. 다시 시도해 주세요.`, "error");
          return;
        }
        toast(`팀에서 ${name}을(를) 제거했어요`);
        onRemoved();
      }}
    >
      모든 멤버의 AI 도구에서 제거돼요.{" "}
      {ownFolderHere || fromAComputer(skill)
        ? "내 컴퓨터의 원본 폴더는 그대로 남아요."
        : "내 컴퓨터의 사본은 그대로 남아요."}
    </ConfirmDialog>
  );
}
