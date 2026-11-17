// A team skill on THIS computer, in two parts on its page:
// - `InstallControl`, in the header's control group (the way Claude shows
//   Install on a plugin page): Install · ✓ Installed ▾ · ✓ Installed for
//   everyone · Fix… for a problem;
// - `SkillAvailability`, the line under the header that only explains:
//   "Use /x in … on this computer" · "Installed for you in [logos]" ·
//   "Installed for everyone in [logos]". Faded logos keep their reasons.

import { useEffect, useState } from "react";
import { revealInFileManager, revealLabel, type SkillTarget } from "../../lib/ipc";
import { skillDisplayName } from "../../lib/skills/display";
import {
  AI_TOOL_NAME,
  detectedAiTools,
  stateLines,
  targetStates,
  teamAvailability,
  type TargetState,
  type ToolAvailability,
} from "../../lib/skills/installState";
import { loadSkillsPrefs, onSkillsPrefsChanged } from "../../lib/skills/prefs";
import { useDeviceScan, type DeviceScan } from "../../lib/skills/deviceScan";
import { CODEX_NEW_CHAT_HINT } from "../../lib/skills/syncEngine";
import {
  applyTeamSkillVersion,
  checkSkillsNow,
  getSkillsDeviceState,
  isSkillOnThisDevice,
  keepMySkill,
  replaceNameTakenSkill,
  quietNextAdd,
  setSkillOnThisDevice,
  useSkillsDeviceState,
} from "../../lib/skills/syncHost";
import type { SkillDetail } from "../../lib/skills/types";
import { toast } from "../../lib/toast";
import { useStore } from "../../store";
import { ConfirmDialog } from "../ConfirmDialog";
import { BusyButton } from "./parts";
import { RequiredBadge } from "./SquareTip";
import { SkillsMenuButton } from "./SkillsMenuButton";
import { ToolMarks } from "./ToolLogos";
import { myAccessOf } from "../../lib/skills/access";

const INSTALL_WAIT_MS = 20_000;

function firstTarget(states: Record<SkillTarget, TargetState>, state: TargetState): SkillTarget | null {
  return (Object.keys(states) as SkillTarget[]).find((t) => states[t] === state) ?? null;
}

/** Show the folder that holds this skill's name in one AI tool's skills folder. */
function revealSkillFolder(target: SkillTarget, name: string): void {
  const root = getSkillsDeviceState().targets.find((t) => t.target === target)?.root;
  if (root) void revealInFileManager(`${root.replace(/[\\/]+$/, "")}/${name}`);
}

/** Is the folder holding this name in that target a symlink (never replaced)? */
function isLinkedFolder(scan: DeviceScan, target: SkillTarget, name: string): boolean {
  if (scan.status !== "ready") return false;
  const location = target === "claude" ? "claudePersonal" : "agentsPersonal";
  return scan.entries.some((e) => e.location === location && e.isSymlink && e.name.toLowerCase() === name.toLowerCase());
}

/** "Claude, Codex, Gemini". */
function toolList(tools: readonly ToolAvailability[]): string {
  const names = tools.map((t) => AI_TOOL_NAME[t.tool]);
  return names.join(", ");
}

/** Everything both parts need about this skill on this computer. */
function useSkillHere(orgId: string, skill: SkillDetail) {
  const device = useSkillsDeviceState();
  const serverUrl = useStore((s) => s.serverUrl);
  const [prefs, setPrefs] = useState(loadSkillsPrefs);
  useEffect(() => onSkillsPrefsChanged(setPrefs), []);
  // This person's own level (an owner/admin may see a skill not shared with them).
  const mine = myAccessOf(skill);
  const optional = mine === "optional";
  const optedIn = mine === "required" || (optional && isSkillOnThisDevice(serverUrl, orgId, skill.id));
  const states = targetStates(device.results, prefs.targets, orgId, skill.id);
  const detected = detectedAiTools(device.targets);
  const tools = teamAvailability(states, optedIn, detected);
  return {
    notMine: mine === "none",
    optional,
    optedIn,
    states,
    tools,
    detected,
    edited: firstTarget(states, "edited"),
    conflict: firstTarget(states, "conflict"),
    conflictKind: device.results.find(
      (r) => r.orgId === orgId && r.skillId === skill.id && r.state === "conflict",
    )?.conflict,
    failed: firstTarget(states, "failed"),
  };
}

/** The header's install control (same 34px group as Publish). */
export function InstallControl({
  orgId,
  skill,
  canManage,
  onMakeOptional,
}: {
  orgId: string;
  skill: SkillDetail;
  canManage: boolean;
  /** Admins: the Required badge's "Make optional" (the skill page's PATCH). */
  onMakeOptional?: () => Promise<void>;
}) {
  const here = useSkillHere(orgId, skill);
  const scan = useDeviceScan();
  const [removing, setRemoving] = useState(false);
  const name = skillDisplayName(skill.name);

  /** Turn it on here and wait for the run to place it (or give up after a cap). */
  const install = async () => {
    quietNextAdd(skill.id);
    setSkillOnThisDevice(orgId, skill.id, true);
    const start = Date.now();
    while (Date.now() - start < INSTALL_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 300));
      const live = targetStates(getSkillsDeviceState().results, loadSkillsPrefs().targets, orgId, skill.id);
      const states = Object.values(live);
      if (states.some((s) => s === "failed" || s === "conflict" || s === "edited")) return;
      if (states.some((s) => s === "installed" || s === "keptMine")) {
        const ready = teamAvailability(live, true, detectedAiTools(getSkillsDeviceState().targets)).filter((t) => t.on);
        const codex = ready.some((t) => t.tool === "codex");
        toast(`${name}을(를) 설치했어요${ready.length ? ` · ${toolList(ready)}에서 사용할 수 있어요` : ""}${codex ? `. ${CODEX_NEW_CHAT_HINT}` : ""}`);
        return;
      }
    }
  };

  if (here.notMine) return <span className="skills-not-yours">나에게 공유되지 않음</span>;
  if (here.optedIn && (here.edited || here.conflict || here.failed)) {
    const actions = here.edited
      ? [
          { key: "keep", label: "내 것 유지", hint: "편집한 사본을 그대로 둬요", onSelect: () => keepMySkill(orgId, skill.id, here.edited!) },
          { key: "team", label: "팀 버전 사용", hint: "내 사본은 먼저 백업돼요", onSelect: () => applyTeamSkillVersion(orgId, skill.id, here.edited!) },
        ]
      : here.conflict
        ? [
            // The folder holding the name is backed up and replaced: the
            // person's own, or another vault's, server's or account's copy.
            // Never a symlink (Rust refuses one either way).
            ...(here.conflictKind !== "unmanaged"
              ? [{ key: "team", label: "팀 버전 사용", hint: "다른 사본은 먼저 백업돼요", onSelect: () => replaceNameTakenSkill(orgId, skill.id, here.conflict!) }]
              : !isLinkedFolder(scan, here.conflict, skill.name)
                ? [{ key: "team", label: "팀 버전 사용", hint: "내 사본은 먼저 백업돼요", onSelect: () => replaceNameTakenSkill(orgId, skill.id, here.conflict!) }]
                : []),
            ...(here.conflictKind === "unmanaged"
              ? [{ key: "keep", label: "내 폴더 유지", hint: "이 컴퓨터의 폴더를 그대로 둬요", onSelect: () => keepMySkill(orgId, skill.id, here.conflict!) }]
              : []),
            { key: "reveal", label: revealLabel(), onSelect: () => revealSkillFolder(here.conflict!, skill.name) },
          ]
        : [{ key: "retry", label: "다시 시도", onSelect: () => checkSkillsNow() }];
    return <SkillsMenuButton label="해결…" className="secondary skills-hdr-btn skills-ctl skills-fix-btn" actions={actions} />;
  }
  if (!here.optional) {
    return (
      <RequiredBadge
        name={name}
        lines={stateLines(here.states, skill.effectiveVersion)}
        canManage={canManage}
        onMakeOptional={canManage ? onMakeOptional : undefined}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.75" y="7.25" width="8.5" height="6" rx="1.5" />
          <path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75" />
        </svg>
        모든 멤버에게 설치됨
      </RequiredBadge>
    );
  }
  if (here.optedIn) {
    return (
      <>
        <SkillsMenuButton
          label={
            <>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 10.5v1.75c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V10.5M5 6.25l2.25 2.25L11.5 4" />
              </svg>
              설치됨
            </>
          }
          className="secondary skills-hdr-btn skills-ctl skills-installed-btn"
          actions={[{ key: "remove", label: "이 컴퓨터에서 제거", onSelect: () => setRemoving(true) }]}
        />
        {removing && (
          <ConfirmDialog
            title={`이 컴퓨터에서 ${name}을(를) 제거할까요?`}
            confirmLabel="제거"
            onCancel={() => setRemoving(false)}
            onConfirm={() => {
              setSkillOnThisDevice(orgId, skill.id, false);
              setRemoving(false);
            }}
          >
            볼트에는 그대로 남아 있어서 언제든 다시 설치할 수 있어요. 편집한 사본은 삭제되지 않고 유지돼요.
          </ConfirmDialog>
        )}
      </>
    );
  }
  return (
    <BusyButton
      className={`${canManage ? "secondary skills-install-strong" : "primary"} skills-hdr-btn skills-ctl`}
      busyLabel="설치하는 중…"
      onClick={install}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      설치
    </BusyButton>
  );
}

/** The explanation line under the header (no buttons: those live in the header). */
export function SkillAvailability({ orgId, skill }: { orgId: string; skill: SkillDetail }) {
  const here = useSkillHere(orgId, skill);
  const name = skillDisplayName(skill.name);

  let body: React.ReactNode;
  if (here.notMine) {
    body = <span className="skills-available-text">나에게 공유되지 않아서 이 컴퓨터에는 없어요. 스킬을 관리하는 권한이 있어서 보이는 거예요.</span>;
  } else if (here.optedIn && here.edited) {
    body = <span className="skills-available-text is-warn">이 컴퓨터에서 편집됨: 이 사본을 바꿨어요. '해결…'에서 내 것을 유지하거나 팀 버전을 쓸 수 있어요.</span>;
  } else if (here.optedIn && here.conflict) {
    body = (
      <span className="skills-available-text is-warn">
        {here.conflictKind === "unmanaged"
          ? "이 컴퓨터에 있는 내 폴더가 같은 이름을 쓰고 있어요. '해결…'에서 어느 쪽을 유지할지 고르세요."
          : "이 컴퓨터의 다른 스킬이 같은 이름을 쓰고 있어요. '해결…'에서 팀 버전으로 바꿀 수 있어요."}
      </span>
    );
  } else if (here.optedIn && here.failed) {
    body = <span className="skills-available-text is-bad">이 컴퓨터에 설치하지 못했어요</span>;
  } else if (!here.optedIn) {
    body = (
      <>
        <span className="skills-available-text">이 컴퓨터의 {toolList(here.tools)}에서 {name} 사용</span>
        <ToolMarks tools={here.tools} names={false} />
      </>
    );
  } else {
    body = (
      <>
        <span className="skills-available-text" title={here.optional ? undefined : "팀에서 필수로 지정해서 제거할 수 없어요"}>
          {here.optional ? "나를 위해 설치됨:" : "모든 멤버에게 설치됨:"}
        </span>
        <ToolMarks tools={here.tools} />
      </>
    );
  }
  return <div className="skills-available">{body}</div>;
}
