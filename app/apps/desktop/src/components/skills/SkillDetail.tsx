// One skill, as a page inside Vault Settings → Skills with a back link (the
// MemberProfilePage pattern). Admins edit the draft, publish, choose Required or
// Optional and pin a version; everyone sees the version history and can
// download any version as a .zip.

import { useCallback, useEffect, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ApiError, skillErrorCode } from "../../lib/api";
import { authManager } from "../../lib/auth/authManager";
import * as ipc from "../../lib/ipc";
import type { SkillAccessLevel, SkillDelivery, SkillDetail as SkillDetailData, SkillVersionSummary } from "../../lib/skills/types";
import { skillMdProblemText, skillNameNeedsWarning, type SkillMdReason, CAP_RULE_TEXT } from "../../lib/skills/validate";
import { publishNotes } from "../../lib/skills/publishNotes";
import { skillDisplayName } from "../../lib/skills/display";
import { toast } from "../../lib/toast";
import { ConfirmDialog } from "../ConfirmDialog";
import { MenuSelect } from "../MenuSelect";
import { RowActionsMenu } from "../RowActionsMenu";
import "../editor.css";
import { AvailableSkeleton, BusyButton, EditorSkeleton, LoadError, SkillByline, SkillHeaderSkeleton, SkillIcon, Tag } from "./parts";
import { loadErrorText, withTimeout } from "../../lib/skills/loading";
import { InstallControl, SkillAvailability } from "./SkillAvailability";
import { showDeliveryNow, useSkillsChanged, useSkillsDeviceState } from "../../lib/skills/syncHost";
import { SkillEditor } from "./SkillEditor";
import { SkillSourceRow } from "./SkillSourceRow";
import { RemoveFromTeamDialog } from "./RemoveFromTeamDialog";
import { SkillSharedWith } from "./SkillSharedWith";
import { AudienceStack } from "./parts";
import { EVERYONE_ACCESS_OPTIONS, hasSkillAccess, myAccessOf } from "../../lib/skills/access";
import { checkSkillsNow } from "../../lib/skills/syncHost";

type Section = "draft" | "access" | "versions";

/** The header's Everyone menu, in its own words (No access = only the people chosen). */
const EVERYONE_HEADER_OPTIONS = EVERYONE_ACCESS_OPTIONS.map((o) => (o.value === "none" ? { ...o, label: "특정 사람" } : o));
const EVERYONE_HEADER_LABEL: Record<SkillAccessLevel, string> = { required: "필수", optional: "선택", none: "특정 사람" };

const DELIVERY_OPTIONS = [
  { value: "required" as const, label: "필수", hint: "모두에게 설치돼요" },
  { value: "optional" as const, label: "선택", hint: "각자 직접 켜요" },
];

function Chevron() {
  return (
    <svg className="skills-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const REFUSAL_TEXT: Record<string, string> = {
  nothing_to_publish: "최신 버전 이후 바뀐 내용이 없어요.",
  stale_draft: "다른 사람이 이 초안을 바꿨어요. 다시 시도해 주세요.",
  ...CAP_RULE_TEXT,
};

/** A publish refusal in plain words (SKILL.md problems name what to fix). */
function publishRefusalText(e: unknown, skillName: string): string {
  const code = skillErrorCode(e);
  if (code === "invalid_skill" && e instanceof ApiError) {
    const reason = (e.body as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === "string") return skillMdProblemText(reason as SkillMdReason, skillName);
  }
  return (code && REFUSAL_TEXT[code]) ?? (e instanceof Error ? e.message : String(e));
}

function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Download one published version as `<name>-v<N>.zip` through the save dialog. */
export async function downloadSkillZip(orgId: string, skillId: string, name: string, version: number): Promise<void> {
  const dest = await saveDialog({
    defaultPath: `${name}-v${version}.zip`,
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (!dest) return;
  const v = await authManager.api.getSkillVersion(orgId, skillId, version);
  await ipc.skillsExportZip(
    dest,
    name,
    v.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64, sha256: f.sha256, executable: f.executable })),
  );
  toast(`${skillDisplayName(name)} v${version}을(를) 저장했어요.`);
}

export function SkillDetail({
  orgId,
  skillId,
  canManage,
  onBack,
  onChanged,
}: {
  orgId: string;
  skillId: string;
  canManage: boolean;
  onBack: () => void;
  /** The catalog row changed (delivery, pin, publish, delete). */
  onChanged: () => void;
}) {
  const [skill, setSkill] = useState<SkillDetailData | null>(null);
  const [section, setSection] = useState<Section>(canManage ? "draft" : "versions");
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const device = useSkillsDeviceState();
  /** The draft editor takes the whole settings panel. */
  const [focus, setFocus] = useState(false);
  /** Bumped when the draft is replaced from outside the editor (restore). */
  const [draftEpoch, setDraftEpoch] = useState(0);
  /** Bumped when the header changes the Everyone row, so the Shared with tab reloads. */
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [confirm, setConfirm] = useState<
    | { kind: "delete" }
    | { kind: "everyoneNone" }
    | { kind: "restore"; version: SkillVersionSummary }
    | null
  >(null);

  const load = useCallback(async () => {
    try {
      setSkill(await withTimeout(authManager.api.getSkill(orgId, skillId)));
      setError(null);
    } catch (e) {
      setError(skillErrorCode(e) === "skill_not_found" ? "이 스킬은 삭제됐어요." : loadErrorText(e));
    }
  }, [orgId, skillId]);

  useEffect(() => {
    void load();
  }, [load]);
  useSkillsChanged(orgId, () => void load());

  /** Shows the change at once, then saves; a refusal puts the page back. */
  const patch = async (change: { delivery?: SkillDelivery; pinnedVersion?: number | null }) => {
    setError(null);
    const undo = change.delivery ? showDeliveryNow(orgId, skillId, change.delivery) : () => {};
    setSkill((s) => (s ? { ...s, ...change } : s));
    try {
      await authManager.api.patchSkill(orgId, skillId, change);
    } catch (e) {
      undo();
      void load();
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    onChanged();
    void load();
  };

  /** The header's Everyone menu: the same write as the Shared with tab's Everyone row. */
  const setEveryone = async (level: SkillAccessLevel) => {
    setError(null);
    try {
      await authManager.api.putSkillAccess(orgId, skillId, { everyone: level });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setAccessEpoch((n) => n + 1);
    onChanged();
    checkSkillsNow();
    void load();
  };

  /** The Required badge's "Make optional": same PATCH as the delivery select, errors to the caller's toast. */
  const makeOptional = async () => {
    const undo = showDeliveryNow(orgId, skillId, "optional");
    setSkill((s) => (s ? { ...s, delivery: "optional" } : s));
    try {
      await authManager.api.patchSkill(orgId, skillId, { delivery: "optional" });
    } catch (e) {
      undo();
      void load();
      throw e;
    }
    toast(`${skillDisplayName(skill?.name ?? "")}을(를) 선택 사항으로 바꿨어요. 이제 각자 컴퓨터에서 제거할 수 있어요.`);
    onChanged();
    void load();
  };

  const full = focus && section === "draft" && canManage;
  useEffect(() => {
    if (!full) return;
    // Capture phase on window, ahead of the settings modal's own Escape: in
    // full view Esc leaves the view, not Settings.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirm) return;
      e.stopPropagation();
      setFocus(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full, confirm]);

  /**
   * One click: save what's pending, then publish with a note written from what
   * changed since the previous version. Refusals come back in plain words.
   */
  const publish = async () => {
    if (!skill || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      if (flushRef.current && !(await flushRef.current())) {
        throw new Error("초안을 저장하지 못해서 게시하지 않았어요.");
      }
      const draft = await authManager.api.getSkillDraft(orgId, skill.id);
      const previous = skill.latestVersion !== null
        ? (await authManager.api.getSkillVersion(orgId, skill.id, skill.latestVersion)).files
        : null;
      const notes = publishNotes(draft.files, previous);
      const v = await authManager.api.publishSkill(orgId, skill.id, draft.revision, notes);
      toast(`${skillDisplayName(skill.name)} v${v.version}을(를) 게시했어요 · 다음 확인 때 모두에게 전달돼요`);
      await load();
      onChanged();
    } catch (e) {
      const text = publishRefusalText(e, skill.name);
      setPublishError(text);
      toast(text, "error");
    } finally {
      setPublishing(false);
    }
  };

  const back = (
    <button type="button" className="link-btn member-profile-back" onClick={onBack}>
      ← 에이전트 스킬
    </button>
  );

  if (!skill) {
    return (
      <section className="member-profile">
        {back}
        {error ? (
          <LoadError
            message={error}
            onRetry={error === "이 스킬은 삭제됐어요." ? undefined : () => {
              setError(null);
              void load();
            }}
          />
        ) : (
          <>
            <SkillHeaderSkeleton />
            <AvailableSkeleton />
            <EditorSkeleton />
          </>
        )}
      </section>
    );
  }

  const latest = skill.latestVersion;
  const pinOptions = [
    { value: "latest", label: latest ? `최신 (v${latest})` : "최신" },
    ...skill.versions.map((v) => ({ value: String(v.version), label: `v${v.version}` })),
  ];
  const nextVersion = (latest ?? 0) + 1;

  return (
    <section className={`member-profile${full ? " skills-focus" : ""}`} aria-label={skill.name}>
      {full ? (
        <div className="skills-focus-bar">
          <span className="skills-row-name">{skillDisplayName(skill.name)}</span>
          <span className="skills-actions">
            {skill.draftDiffers ? (
              <BusyButton className="primary skills-btn-sm" busyLabel="게시하는 중…" onClick={publish}>
                v{nextVersion} 게시
              </BusyButton>
            ) : (
              <span className="skills-published">게시됨</span>
            )}
          </span>
        </div>
      ) : (
      <>
      {back}
      <div className="skills-detail-head">
        <SkillIcon large />
        <div className="skills-detail-title">
          <div className="skills-title-row">
            <h2 className="settings-section-title">{skillDisplayName(skill.name)}</h2>
            <span className="skills-source-pill">{skill.source ? `${skill.source.repo}에서 가져옴` : "팀과 공유 중"}</span>
          </div>
          <SkillByline skill={skill} />
          {skill.sharedWith && (
            canManage ? (
              <button type="button" className="link-btn skills-audience-btn" onClick={() => setSection("access")} aria-label="이 스킬을 가진 사람 보기">
                <AudienceStack audience={skill.sharedWith} viewerIn={myAccessOf(skill) !== "none"} />
              </button>
            ) : (
              <AudienceStack audience={skill.sharedWith} viewerIn />
            )
          )}
          {skillNameNeedsWarning(skill.name) && (
            <span className="skills-warning">claude.ai는 "claude" 또는 "anthropic"이 들어간 이름을 허용하지 않아요.</span>
          )}
        </div>
        <div className="skills-detail-controls">
          {device.active && skill.effectiveVersion !== null && (
            <InstallControl orgId={orgId} skill={skill} canManage={canManage} onMakeOptional={makeOptional} />
          )}
          {canManage ? (
            <>
              {hasSkillAccess(skill) && skill.everyone ? (
                <MenuSelect
                  value={skill.everyone}
                  options={EVERYONE_HEADER_OPTIONS}
                  onSelect={(level) => (level === "none" ? setConfirm({ kind: "everyoneNone" }) : void setEveryone(level))}
                  ariaLabel="이 스킬을 받는 사람"
                  caret={false}
                  triggerClassName="secondary skills-hdr-btn skills-ctl"
                  triggerContent={<>{EVERYONE_HEADER_LABEL[skill.everyone]}<Chevron /></>}
                />
              ) : (
                <MenuSelect
                  value={skill.delivery}
                  options={DELIVERY_OPTIONS}
                  onSelect={(delivery) => patch({ delivery })}
                  ariaLabel="이 스킬을 받는 사람"
                  caret={false}
                  triggerClassName="secondary skills-hdr-btn skills-ctl"
                  triggerContent={<>{skill.delivery === "required" ? "필수" : "선택"}<Chevron /></>}
                />
              )}
              {skill.versions.length > 0 && (
                <MenuSelect
                  value={skill.pinnedVersion === null ? "latest" : String(skill.pinnedVersion)}
                  options={pinOptions}
                  onSelect={(v) => patch({ pinnedVersion: v === "latest" ? null : Number(v) })}
                  ariaLabel="모두가 받는 버전"
                  caret={false}
                  triggerClassName="secondary skills-hdr-btn skills-ctl"
                  triggerContent={
                    <>
                      {skill.pinnedVersion === null ? `최신 (v${latest})` : `v${skill.pinnedVersion}`}
                      <Chevron />
                    </>
                  }
                />
              )}
              {skill.draftDiffers ? (
                <BusyButton className="primary skills-hdr-btn skills-ctl" busyLabel="게시하는 중…" onClick={publish}>
                  v{nextVersion} 게시
                </BusyButton>
              ) : (
                <span className="skills-published" title="최신 버전 이후 바뀐 내용이 없어요">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  게시됨
                </span>
              )}
            </>
          ) : (
            <span className="skills-meta-line">
              {skill.delivery === "required" ? "필수" : "선택"}
              {skill.pinnedVersion !== null ? ` · v${skill.pinnedVersion}로 고정` : ""}
            </span>
          )}
          <RowActionsMenu
            ariaLabel={`${skillDisplayName(skill.name)} 더 보기`}
            actions={[
              ...(skill.effectiveVersion !== null
                ? [{
                    key: "zip",
                    label: `.zip 다운로드 (v${skill.effectiveVersion})`,
                    onSelect: () => downloadSkillZip(orgId, skill.id, skill.name, skill.effectiveVersion!),
                  }]
                : []),
              ...(canManage
                ? [{ key: "delete", label: "팀에서 제거", danger: true, separated: skill.effectiveVersion !== null, onSelect: () => setConfirm({ kind: "delete" }) }]
                : []),
            ]}
          />
        </div>
      </div>

      </>
      )}

      {!full && (
      <>
      {device.active && skill.effectiveVersion !== null && <SkillAvailability orgId={orgId} skill={skill} />}
      {skill.source && (
        <SkillSourceRow
          orgId={orgId}
          skillId={skill.id}
          skillName={skill.name}
          source={skill.source}
          canManage={canManage}
          onPulled={() => {
            setSection("draft");
            setDraftEpoch((n) => n + 1);
            void load();
            onChanged();
          }}
        />
      )}

      {canManage && (
        <div className="member-profile-tabs" role="tablist" aria-label="스킬">
          {(hasSkillAccess(skill) ? (["draft", "access", "versions"] as const) : (["draft", "versions"] as const)).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === section}
              className={`member-profile-tab${s === section ? " active" : ""}`}
              onClick={() => setSection(s)}
            >
              {s === "draft"
                ? "개요"
                : s === "access"
                  ? `공유 대상${skill.sharedWith ? ` · ${skill.sharedWith.count}` : ""}`
                  : `버전${skill.versions.length ? ` · ${skill.versions.length}` : ""}`}
            </button>
          ))}
        </div>
      )}
      </>
      )}

      {error && <div className="auth-error">{error}</div>}

      {section === "access" && canManage ? (
        <SkillSharedWith
          key={accessEpoch}
          orgId={orgId}
          skillId={skill.id}
          skillName={skill.name}
          onChanged={() => {
            onChanged();
            void load();
          }}
        />
      ) : section === "draft" && canManage ? (
        <SkillEditor
          key={draftEpoch}
          orgId={orgId}
          skill={skill}
          onSaved={() => void load()}
          focus={full}
          onToggleFocus={() => setFocus((f) => !f)}
          flushRef={flushRef}
          publishError={publishError}
        />
      ) : skill.versions.length === 0 ? (
        <div className="muted skills-quiet">아직 게시되지 않았어요.</div>
      ) : (
        <ul className="skills-list">
          {skill.versions.map((v) => (
            <li key={v.version} className="skills-list-row is-static">
              <span className="skills-icon skills-version-badge">v{v.version}</span>
              <span className="skills-row-main">
                <span className="skills-row-name">{v.notes || `버전 ${v.version}`}</span>
                <span className="skills-row-desc">
                  {dateText(v.publishedAt)}
                  {v.publishedBy ? ` · ${v.publishedBy.name}` : ""}
                  {` · 파일 ${v.fileCount}개`}
                </span>
              </span>
              <span className="skills-row-side">
                {skill.effectiveVersion === v.version && <Tag tone="good">사용 중</Tag>}
                <BusyButton
                  className="link-btn skills-row-link"
                  busyLabel="준비하는 중…"
                  onClick={() => downloadSkillZip(orgId, skill.id, skill.name, v.version)}
                >
                  .zip 다운로드
                </BusyButton>
                {canManage && (
                  <RowActionsMenu
                    ariaLabel={`v${v.version} 더 보기`}
                    actions={[{ key: "restore", label: "초안으로 복원", onSelect: () => setConfirm({ kind: "restore", version: v }) }]}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}


      {confirm?.kind === "delete" && (
        <RemoveFromTeamDialog
          orgId={orgId}
          skill={skill}
          onCancel={() => setConfirm(null)}
          onRemoved={() => {
            setConfirm(null);
            onChanged();
            onBack();
          }}
        />
      )}

      {confirm?.kind === "everyoneNone" && (
        <ConfirmDialog
          title={`모든 사람에게서 ${skillDisplayName(skill.name)}을(를) 회수할까요?`}
          confirmLabel="회수"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await setEveryone("none");
            setSection("access");
          }}
        >
          공유 대상에 추가한 사람만 이 스킬을 받아요. 수정하지 않은 복사본은 다른 사람의 컴퓨터에서 제거되고,
          수정한 복사본은 그 사람의 개인 스킬로 남아요.
        </ConfirmDialog>
      )}

      {confirm?.kind === "restore" && (
        <ConfirmDialog
          title={`초안을 v${confirm.version.version}(으)로 바꿀까요?`}
          confirmLabel="초안 바꾸기"
          tone="accent"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await authManager.api.resetSkillDraft(orgId, skill.id, skill.draftRevision, confirm.version.version);
              toast(`이제 초안이 v${confirm.version.version}과(와) 같아요.`);
            } catch (e) {
              setError(skillErrorCode(e) === "stale_draft"
                ? "다른 사람이 초안을 바꿨어요. 다시 시도해 주세요."
                : e instanceof Error ? e.message : String(e));
            }
            setConfirm(null);
            setSection("draft");
            setDraftEpoch((n) => n + 1);
            await load();
          }}
        >
          게시하지 않은 초안의 변경 내용은 사라져요. 게시된 버전은 그대로 유지돼요.
        </ConfirmDialog>
      )}
    </section>
  );
}
