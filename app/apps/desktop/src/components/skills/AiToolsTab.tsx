// Account Settings → AI tools: what THIS machine does with team skills
// (docs/SKILLS.md §5.5). Which tool folders it writes, and per skill across
// every vault on this server whether the copy here is current, edited by hand,
// or blocked by another folder of the same name.

import { useEffect, useState } from "react";
import * as ipc from "../../lib/ipc";
import { authManager } from "../../lib/auth/authManager";
import { toast } from "../../lib/toast";
import type { SkillTarget, SkillTargetInfo } from "../../lib/ipc";
import { loadSkillsPrefs, onSkillsPrefsChanged } from "../../lib/skills/prefs";
import { skillDisplayName } from "../../lib/skills/display";
import {
  checkSkillsNow,
  isSkillOnThisDevice,
  keepMySkill,
  replaceNameTakenSkill,
  setSkillOnThisDevice,
  setSkillTargetEnabled,
  showDeliveryNow,
  useSkillsDeviceState,
  applyTeamSkillVersion,
} from "../../lib/skills/syncHost";
import { useStore } from "../../store";
import { AsyncButton } from "../AsyncButton";
import { RowActionsMenu } from "../RowActionsMenu";
import { Spinner } from "../Spinner";
import { ConfirmDialog } from "../ConfirmDialog";
import { Switch } from "../Switch";
import { ToolLogo } from "./ToolLogos";
import "../editor.css";
import { EmptyState, InstallButton, LoadError, ProgressBar, SkeletonCards, TARGET_SHORT, ToolRowSkeleton, WarnMark } from "./parts";
import { SkillsMenuButton } from "./SkillsMenuButton";
import { TipAnchor } from "./SquareTip";
import { overallState, stateLines, targetStates } from "../../lib/skills/installState";
import type { ManifestSkill } from "../../lib/skills/types";
import "./skills.css";

const TARGET_LABEL: Record<SkillTarget, string> = {
  claude: "Claude",
  agents: "Codex 및 기타 도구",
};

const TOOL_NAME: Record<string, string> = {
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  copilot: "Copilot",
  opencode: "OpenCode",
};


function installedText(t: SkillTargetInfo): string {
  if (t.target === "claude") return t.toolInstalled ? "감지됨" : "설치 안 됨";
  if (t.detectedTools.length === 0) return "설치 안 됨";
  return `감지됨: ${t.detectedTools.map((d) => TOOL_NAME[d] ?? d).join(", ")}`;
}

export function AiToolsTab() {
  const state = useSkillsDeviceState();
  const serverUrl = useStore((s) => s.serverUrl);
  const [prefs, setPrefs] = useState(loadSkillsPrefs);
  const [targets, setTargets] = useState<SkillTargetInfo[]>(state.targets);
  const [removing, setRemoving] = useState<{ orgId: string; skillId: string; name: string } | null>(null);

  useEffect(() => onSkillsPrefsChanged(setPrefs), []);
  useEffect(() => {
    if (state.targets.length > 0) {
      setTargets(state.targets);
      return;
    }
    // Before the first run finishes the paths still deserve to be shown.
    let cancelled = false;
    ipc.skillsTargets().then(
      (t) => {
        if (!cancelled) setTargets(t);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [state.targets]);

  if (state.unsupported) {
    return <div className="muted">스킬을 동기화하려면 서버를 업데이트해야 해요.</div>;
  }

  const results = state.results;

  const rows = (state.manifest?.orgs ?? []).flatMap((org) =>
    org.skills.map((skill) => ({ org, skill })),
  );

  /**
   * The Skills tab's install square for one skill on this computer: + to use
   * it, ✓ when here (Required can't be removed), and the amber "!" with its
   * choices when a copy here was edited, its name is taken, or it failed.
   */
  const square = (orgId: string, role: string, skill: ManifestSkill) => {
    const optional = skill.delivery === "optional";
    const on = !optional || isSkillOnThisDevice(serverUrl, orgId, skill.skillId);
    const states = targetStates(results, prefs.targets, orgId, skill.skillId);
    const overall = overallState(states);
    const lines = stateLines(states, skill.version).join("\n");
    if (on && (overall === "warn" || overall === "bad")) {
      const targetsIn = (state: string) => (Object.keys(states) as SkillTarget[]).filter((t) => states[t] === state);
      const edited = targetsIn("edited");
      const conflict = targetsIn("conflict");
      const which = (t: SkillTarget, many: boolean, label: string) => (many ? `${label} (${TARGET_SHORT[t]})` : label);
      const actions = [
        ...edited.flatMap((t) => [
          { key: `keep-${t}`, label: which(t, edited.length > 1, "내 버전 유지"), hint: "수정한 복사본을 그대로 둬요", onSelect: () => keepMySkill(orgId, skill.skillId, t) },
          { key: `team-${t}`, label: which(t, edited.length > 1, "팀 버전 사용"), hint: "내 복사본은 먼저 백업돼요", onSelect: () => applyTeamSkillVersion(orgId, skill.skillId, t) },
        ]),
        ...conflict.flatMap((t) => {
          const own = results.find((r) => r.orgId === orgId && r.skillId === skill.skillId && r.target === t)?.conflict === "unmanaged";
          return own
            ? [
                { key: `nt-team-${t}`, label: which(t, conflict.length > 1, "팀 버전 사용"), hint: "내 복사본은 먼저 백업돼요", onSelect: () => replaceNameTakenSkill(orgId, skill.skillId, t) },
                { key: `nt-keep-${t}`, label: which(t, conflict.length > 1, "내 폴더 유지"), hint: "이 컴퓨터의 폴더를 그대로 둬요", onSelect: () => keepMySkill(orgId, skill.skillId, t) },
              ]
            : [
                // Another vault's, server's or account's copy: backed up, then replaced.
                { key: `nt-team-${t}`, label: which(t, conflict.length > 1, "팀 버전 사용"), hint: "다른 복사본은 먼저 백업돼요", onSelect: () => replaceNameTakenSkill(orgId, skill.skillId, t) },
              ];
        }),
        { key: "check", label: "다시 확인", onSelect: () => checkSkillsNow() },
      ];
      return (
        <TipAnchor content={{ heading: overall === "bad" ? "이 컴퓨터에 설치하지 못했어요" : "이 컴퓨터에서 확인이 필요해요", lines: lines.split("\n"), note: "눌러서 할 일을 선택하세요" }}>
          <SkillsMenuButton
            label={<WarnMark />}
            caret={false}
            className={`skills-install is-${overall}`}
            ariaLabel={`${skillDisplayName(skill.name)} 해결. ${lines.split("\n").join(". ")}`}
            actions={actions}
          />
        </TipAnchor>
      );
    }
    if (!optional) {
      const canManage = role === "owner" || role === "admin";
      return (
        <InstallButton
          kind="required"
          title={`팀에서 필수로 지정했어요\n${lines}`}
          name={skill.name}
          canManage={canManage}
          onMakeOptional={
            canManage
              ? async () => {
                  const undo = showDeliveryNow(orgId, skill.skillId, "optional");
                  try {
                    await authManager.api.patchSkill(orgId, skill.skillId, { delivery: "optional" });
                  } catch (e) {
                    undo();
                    throw e;
                  }
                  toast(`${skillDisplayName(skill.name)}을(를) 선택 사항으로 바꿨어요. 이제 각자 컴퓨터에서 제거할 수 있어요.`);
                  checkSkillsNow();
                }
              : undefined
          }
        />
      );
    }
    if (on) {
      return (
        <InstallButton
          kind="installed"
          title={`이 컴퓨터에 설치됨 · 눌러서 제거\n${lines}`}
          onClick={() => setRemoving({ orgId, skillId: skill.skillId, name: skill.name })}
        />
      );
    }
    return <InstallButton kind="install" title="이 컴퓨터에서 사용" onClick={() => setSkillOnThisDevice(orgId, skill.skillId, true)} />;
  };

  const openBackups = async () => {
    const dir = await ipc.skillsBackupsDir();
    await ipc.openInFileManager(dir);
  };

  const checkButton = (
    <AsyncButton
      className="secondary skills-btn-sm"
      disabled={!state.active || state.running}
      onClick={() => checkSkillsNow()}
    >
      {state.running ? (
        <span className="skills-inline">
          <Spinner size="xs" /> 확인 중…
        </span>
      ) : (
        "지금 확인"
      )}
    </AsyncButton>
  );

  return (
    <>
      <p className="ai-tools-lede">볼트의 스킬이 이 컴퓨터의 AI 도구에 설치돼요.</p>
      <div className="profile-rows ai-tools-rows">
        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">설치할 도구</span>
            <span className="profile-row-hint">
              이 컴퓨터에서 찾은 도구예요. 끄면 해당 도구에는 스킬을 설치하지 않아요.
            </span>
          </div>
          <div className="profile-row-control ai-tools-list">
            {targets.length === 0 && <ToolRowSkeleton />}
            {targets.map((t) => (
              <label key={t.target} className="ai-tool">
                <span className="skills-tool-cluster ai-tool-logos">
                  {(t.target === "claude" ? (["claude"] as const) : (["codex", "cursor", "gemini"] as const)).map((tool) => (
                    <ToolLogo key={tool} tool={tool} size={16} />
                  ))}
                </span>
                <span className="ai-tool-text">
                  <span className="ai-tool-name">{TARGET_LABEL[t.target]}</span>
                  <code className="ai-tool-path">{t.root}</code>
                </span>
                <span className={`ai-tool-tag${installedText(t) === "설치 안 됨" ? " is-off" : ""}`}>
                  {installedText(t).replace(/^감지됨: /, "")}
                </span>
                <Switch
                  checked={prefs.targets[t.target]}
                  ariaLabel={`${TARGET_LABEL[t.target]}에 스킬 설치`}
                  onChange={(next) => setSkillTargetEnabled(t.target, next)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">이 컴퓨터의 스킬</span>
            <span className="profile-row-hint">
              필수 스킬은 항상 설치돼요. 선택 스킬은 직접 추가하거나 제거할 수 있어요.
            </span>
            <span className="ai-tools-actions">
              {checkButton}
              <RowActionsMenu
                ariaLabel="더 보기"
                actions={[{ key: "backups", label: "백업 폴더 열기", onSelect: openBackups }]}
              />
            </span>
          </div>
          <div className="profile-row-control ai-tools-list">
            <ProgressBar active={state.running && !!state.manifest} />
            {state.lastError && (
              <LoadError message={`스킬을 확인하지 못했어요: ${state.lastError}`} onRetry={() => checkSkillsNow()} />
            )}
            {!state.active ? (
              <div className="muted">로그인하면 팀의 스킬을 받을 수 있어요.</div>
            ) : !state.manifest ? (
              <SkeletonCards count={3} label="스킬을 확인하는 중" />
            ) : rows.length === 0 ? (
              <EmptyState title="아직 스킬이 없어요">볼트에 게시된 스킬이 없어요.</EmptyState>
            ) : (
              <ul className="ai-skills">
                {rows.map(({ org, skill }) => (
                  <li key={`${org.orgId}:${skill.skillId}`} className="ai-skill">
                    <span className="ai-skill-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                        <path d="M14 3v5h5M9 13h6M9 17h4" />
                      </svg>
                    </span>
                    <span className="ai-skill-text">
                      <span className="ai-skill-name">{skillDisplayName(skill.name)}</span>
                      <span className="ai-skill-meta" title={skill.description || undefined}>
                        {org.orgName} · v{skill.version}
                        {skill.description ? ` · ${skill.description}` : ""}
                      </span>
                    </span>
                    <span className={`ai-skill-tag${skill.delivery === "optional" ? " is-optional" : ""}`}>
                      {skill.delivery === "optional" ? "선택" : "필수"}
                    </span>
                    {square(org.orgId, org.role, skill)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title={`이 컴퓨터에서 ${skillDisplayName(removing.name)}을(를) 제거할까요?`}
          confirmLabel="제거"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setSkillOnThisDevice(removing.orgId, removing.skillId, false);
            setRemoving(null);
          }}
        >
          볼트에는 그대로 남아 있어서 언제든 다시 추가할 수 있어요. 수정한 복사본은 삭제되지 않고 유지돼요.
        </ConfirmDialog>
      )}
    </>
  );
}
