// Skills tab → "On this device": every skill this computer's AI tools can see,
// read by Rust's `skills_scan_device` (read-only), grouped by
// `lib/skills/deviceGrouping.ts`. Clicking one opens a read-only preview of its
// SKILL.md; admins can add a personal or plugin skill to the team, which
// reads the folder (`skillsReadFolder`), uploads it and publishes v1.

import { useEffect, useState } from "react";
import { skillErrorCode } from "../../lib/api";
import { authManager } from "../../lib/auth/authManager";
import * as ipc from "../../lib/ipc";
import {
  countLive,
  deviceAvailability,
  deviceItems,
  groupDeviceSkills,
  isDisabled,
  tildePath,
  usedByText,
  type DeviceGroup,
  type DeviceItem,
} from "../../lib/skills/deviceGrouping";
import { skillDisplayName } from "../../lib/skills/display";
import { useSkillsDeviceState } from "../../lib/skills/syncHost";
import type { SkillSummary } from "../../lib/skills/types";
import { base64ToText, isValidSkillName, limitProblemText, parseSkillFrontmatter, suggestSkillName } from "../../lib/skills/validate";
import { toast } from "../../lib/toast";
import { useStore } from "../../store";
import { markDeviceSeen, scanDevice, useDeviceScan } from "../../lib/skills/deviceScan";
import { DeviceSkillFiles } from "./DeviceSkillFiles";
import { AvailableIn, ToolLogo } from "./ToolLogos";
import { AI_TOOL_NAME, detectedAiTools } from "../../lib/skills/installState";
import { AsyncButton } from "../AsyncButton";
import { BusyButton, SkillCard, EmptyState, InstallButton, LoadError, ProgressBar, SkillGridSkeleton, SkillIcon, Tag, withTildes } from "./parts";


function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function filesText(item: DeviceItem): string {
  return `${item.fileCount}${item.truncated ? "+" : ""} ${item.fileCount === 1 && !item.truncated ? "file" : "files"}`;
}

/** Home folder, read off the agents root (`<home>/.agents/skills`). */
function homeOf(targets: readonly ipc.SkillTargetInfo[]): string | null {
  const root = targets.find((t) => t.target === "agents")?.root;
  return root?.endsWith("/.agents/skills") ? root.slice(0, -"/.agents/skills".length) : null;
}

export function DeviceSkillsView({
  onPageChange,
  filter,
  orgId,
  canShare,
  vaultSkills,
  onShared,
  onAddedHere,
  onOpenTeamSkill,
  closePage = 0,
}: {
  /** The Skills tab toolbar's search. */
  filter: string;
  orgId: string;
  /** Owners/admins: offer Add to team. */
  canShare: boolean;
  vaultSkills: readonly SkillSummary[];
  /** A skill was added to the vault; ring it on the Team grid. */
  onShared: (skillId: string) => void;
  /** A card's quick Add to team: refresh the catalog but stay on this view. */
  onAddedHere?: (skillId: string) => void;
  /** Open a team skill's page (the Team tab's), from a card's "shared" square. */
  onOpenTeamSkill?: (skillId: string) => void;
  /** Bumped by the tab's "← On this device" link (above the page title): back to the grid. */
  closePage?: number;
  /** A skill's page is open (the tab hides its footer there). */
  onPageChange?: (open: boolean) => void;
}) {
  const device = useSkillsDeviceState();
  // The session's scan (the Skills tab already started it); Refresh rescans.
  const scan = useDeviceScan();
  const [showDisabled, setShowDisabled] = useState(false);
  /** Groups flipped from their default: the first open, the rest closed. */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<DeviceItem | null>(null);
  useEffect(() => {
    if (closePage > 0) setOpen(null);
  }, [closePage]);
  const me = useStore((s) => s.session?.user.name || s.session?.user.email || "팀원");
  /** Cards whose quick Add to team is running. */
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  // Which AI tools are installed here; signed out (no skills host) asks Rust directly.
  const [ownTargets, setOwnTargets] = useState<ipc.SkillTargetInfo[]>([]);
  useEffect(() => {
    if (device.targets.length === 0) ipc.skillsTargets().then(setOwnTargets, () => {});
  }, [device.targets.length]);
  const detected = detectedAiTools(device.targets.length > 0 ? device.targets : ownTargets);
  useEffect(() => {
    onPageChange?.(open !== null);
    return () => onPageChange?.(false);
  }, [open, onPageChange]);
  const [home, setHome] = useState<string | null>(homeOf(device.targets));

  const refresh = () => scanDevice(true);

  useEffect(() => {
    // The first visit to this view on this computer stops the toggle's dot.
    markDeviceSeen();
    if (!home) {
      ipc.skillsTargets().then((t) => setHome(homeOf(t)), () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (open) {
    return (
      <DeviceSkillPreview
        item={open}
        home={home}
        orgId={orgId}
        canShare={canShare && !open.managed}
        vaultSkills={vaultSkills}
        onShared={onShared}
        onOpenTeamSkill={onOpenTeamSkill}
      />
    );
  }

  const entries = scan.status === "ready" ? scan.entries : [];
  const allItems = deviceItems(entries);
  const total = countLive(allItems);
  const disabled = allItems.filter(isDisabled).length;
  const groups = groupDeviceSkills(entries, filter, showDisabled);
  const toggle = (key: string) =>
    setFlipped((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** "7 files", plus the plugin and where it lives when the name is shared; the tools are logos at the foot. */
  const metaText = (item: DeviceItem) =>
    [
      item.pluginName ? `${item.pluginName}${item.pluginVersion ? ` v${item.pluginVersion}` : ""}` : null,
      item.hint,
      filesText(item),
    ]
      .filter(Boolean)
      .join(" · ");

  const itemProps = (item: DeviceItem) => ({
    role: "button" as const,
    tabIndex: 0,
    title: tildePath(item.paths[0], home),
    onClick: () => setOpen(item),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") setOpen(item);
    },
  });

  const quickAdd = async (item: DeviceItem) => {
    setAdding((a) => new Set(a).add(item.realPath));
    try {
      await addDeviceSkillToTeam({ item, orgId, vaultSkills, me, onShared: (id) => onAddedHere?.(id) });
    } finally {
      setAdding((a) => {
        const next = new Set(a);
        next.delete(item.realPath);
        return next;
      });
    }
  };
  /** The AI tools that can use this skill here, as small marks at the card's foot. */
  const toolMarks = (item: DeviceItem) => {
    const on = deviceAvailability(item, detected).filter((t) => t.on);
    if (on.length === 0) return null;
    return (
      <span className="skills-card-tools" aria-label={`이 컴퓨터에서 ${on.map((t) => AI_TOOL_NAME[t.tool]).join(", ")}에서 사용`}>
        {on.map((t) => (
          <ToolLogo key={t.tool} tool={t.tool} size={14} title={`이 컴퓨터에서 ${AI_TOOL_NAME[t.tool]}가 사용해요`} />
        ))}
      </span>
    );
  };

  /** The card's square: Add to team, busy, or a ✓ once the team has that name. */
  const shareAction = (item: DeviceItem) => {
    if (!canShare) return undefined;
    if (adding.has(item.realPath)) return <InstallButton kind="busy" title="팀에 추가하는 중…" />;
    const team = vaultSkills.find((v) => v.name.toLowerCase() === item.name.toLowerCase());
    if (team) {
      return (
        <InstallButton
          kind="shared"
          title={`이미 팀과 공유됨${onOpenTeamSkill ? "\n클릭하면 팀의 사본을 열어요" : ""}`}
          onClick={onOpenTeamSkill ? () => onOpenTeamSkill(team.id) : undefined}
        />
      );
    }
    return (
      <InstallButton
        kind="share"
        title="팀에 추가\n모든 멤버의 컴퓨터에 설치돼요"
        onClick={() => void quickAdd(item)}
      />
    );
  };

  const body = (g: DeviceGroup) => (
      <ul className="skills-grid">
        {g.items.map((item) => (
          <SkillCard
            key={`${item.realPath}|${item.hint ?? ""}`}
            name={item.name}
            byline={
              <>
                <span className="skills-meta-line" title={metaText(item)}>{withTildes(metaText(item))}</span>
                {isDisabled(item) && <Tag>Claude에서 꺼짐</Tag>}
              </>
            }
            description={item.description || "설명이 없어요."}
            footer={toolMarks(item)}
            action={shareAction(item)}
            className={isDisabled(item) ? "is-disabled" : ""}
            li={itemProps(item)}
          />
        ))}
      </ul>
  );

  return (
    <>
      {/* Refresh is in the tab's header; its bar floats in the gap below it,
          taking no room, so this tab's content starts where Team's does. */}
      <ProgressBar floating active={scan.status === "ready" && !!scan.refreshing} />

      {scan.status === "ready" && scan.errors.length > 0 && (
        <div className="field-hint skills-quiet-line" title={scan.errors.map((e) => `${e.root}: ${e.error}`).join("\n")}>
          {scan.errors.length === 1 ? "폴더 1개를 읽을 수 없어요." : `폴더 ${scan.errors.length}개를 읽을 수 없어요.`}
        </div>
      )}

      {scan.status === "loading" ? (
        <SkillGridSkeleton count={6} label="이 컴퓨터의 스킬을 불러오는 중" />
      ) : scan.status === "error" ? (
        <LoadError message={`이 컴퓨터의 스킬을 확인할 수 없어요: ${scan.message}`} onRetry={() => void refresh()} />
      ) : total === 0 && !(showDisabled && disabled > 0) ? (
        <EmptyState
          title="이 컴퓨터에는 아직 스킬이 없어요"
          actions={
            disabled > 0 && !showDisabled ? (
              <button className="secondary" onClick={() => setShowDisabled(true)}>꺼진 플러그인 보기 ({disabled})</button>
            ) : undefined
          }
        >
          Claude, Codex 등 AI 도구에 추가한 스킬이 여기에 표시돼요.
        </EmptyState>
      ) : (
        <>
          {groups.length === 0 && <div className="field-hint skills-quiet">일치하는 스킬이 없어요.</div>}
          {groups.map((g, gi) => {
            // A search shows every match; otherwise only the first group starts open.
            const isCollapsed = !filter.trim() && (gi > 0) !== flipped.has(g.key);
            return (
              <section key={g.key} className="skills-group">
                <button
                  type="button"
                  className="skills-group-head is-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(g.key)}
                >
                  <svg className={`skills-caret${isCollapsed ? " is-closed" : ""}`} viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{g.label}</span>
                  {g.kind === "claudePlugin" && <Tag>Claude plugin</Tag>}
                  {g.kind === "codexPlugin" && <Tag>Codex plugin</Tag>}
                  <span className="skills-group-count">{g.items.length}</span>
                </button>
                {!isCollapsed && body(g)}
              </section>
            );
          })}
          {disabled > 0 && (
            <button type="button" className="link-btn skills-disabled-toggle" onClick={() => setShowDisabled((v) => !v)}>
              {showDisabled ? "꺼진 플러그인 숨기기" : `꺼진 플러그인 보기 (${disabled})`}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** Where a skill on this computer comes from, for the page's source pill. */
function deviceSourceLabel(item: DeviceItem): string {
  if (item.managed) return "팀에서 받음";
  const l = item.locations;
  if (l.some((x) => x === "claudePersonal" || x === "agentsPersonal" || x === "codexPersonal")) return "내 스킬";
  if (l.includes("claudePlugin")) return "Claude 플러그인";
  if (l.includes("codexPlugin")) return "Codex 플러그인";
  if (l.includes("claudeSynced")) return "Claude 조직";
  return "Codex 기본 제공";
}

/** "Couldn't add /x to the team: it has more than 1000 files. Remove …" */
function addFailedText(name: string, raw: string): string {
  return `${skillDisplayName(name)}을(를) 팀에 추가하지 못했어요: ${limitProblemText(raw) ?? raw}`;
}

/**
 * Add a skill on this computer to the team: read its folder (Rust's reader:
 * no dot folders or build output, no symlinks inside, the upload caps), create
 * it under its SKILL.md name and make it Required and publish v1, so it installs for everyone.
 */
async function addDeviceSkillToTeam({
  item,
  orgId,
  vaultSkills,
  me,
  onShared,
}: {
  item: DeviceItem;
  orgId: string;
  vaultSkills: readonly SkillSummary[];
  me: string;
  onShared: (skillId: string) => void;
}): Promise<void> {
  let bundle: ipc.SkillBundle;
  try {
    bundle = await ipc.skillsReadFolder(item.realPath);
  } catch (e) {
    toast(addFailedText(item.name, message(e)), "error");
    return;
  }
  const mdFile = bundle.files.find((f) => f.path === "SKILL.md");
  const skillMd = mdFile ? base64ToText(mdFile.contentBase64) : null;
  const fm = skillMd ? parseSkillFrontmatter(skillMd) : null;
  const name = fm?.ok && isValidSkillName(fm.name) ? fm.name : suggestSkillName(bundle.suggestedName);
  if (!isValidSkillName(name)) {
    toast(`"${item.name}"은(는) 스킬 이름으로 쓸 수 없어요.`, "error");
    return;
  }
  if (vaultSkills.some((s) => s.name === name)) {
    toast(`${skillDisplayName(name)}이라는 스킬이 이 볼트에 이미 있어요.`, "error");
    return;
  }
  try {
    const files = bundle.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64, executable: f.executable, sha256: f.sha256 }));
    const created = await authManager.api.createSkill(orgId, name, files);
    try {
      // Required before v1 goes out, so it lands on everyone's computer with the publish.
      await authManager.api.patchSkill(orgId, created.id, { delivery: "required" });
      await authManager.api.publishSkill(orgId, created.id, created.draftRevision, `${me}님의 컴퓨터에서 추가함`);
      toast(`${skillDisplayName(name)}을(를) 팀에 추가했어요 · 모든 멤버의 컴퓨터에 설치 중이에요`);
    } catch (e) {
      toast(`${skillDisplayName(name)}을(를) 팀에 초안으로 추가했어요: ${message(e)}`, "neutral");
    }
    onShared(created.id);
  } catch (e) {
    toast(
      skillErrorCode(e) === "skill_name_taken"
        ? `${skillDisplayName(name)}이라는 스킬이 이 볼트에 이미 있어요.`
        : addFailedText(name, skillErrorCode(e) ?? message(e)),
      "error",
    );
  }
}

/** One device skill, read-only: where it lives, its SKILL.md, and Add to team. */
function DeviceSkillPreview({
  item,
  home,
  orgId,
  canShare,
  vaultSkills,
  onShared,
  onOpenTeamSkill,
}: {
  item: DeviceItem;
  home: string | null;
  orgId: string;
  canShare: boolean;
  vaultSkills: readonly SkillSummary[];
  onShared: (skillId: string) => void;
  onOpenTeamSkill?: (skillId: string) => void;
}) {
  /** The team's skill of the same name: then this page offers it, not Add to team. */
  const team = vaultSkills.find((v) => v.name.toLowerCase() === item.name.toLowerCase());
  const hostTargets = useSkillsDeviceState().targets;
  const [ownTargets, setOwnTargets] = useState<ipc.SkillTargetInfo[]>([]);
  const targets = hostTargets.length > 0 ? hostTargets : ownTargets;
  useEffect(() => {
    // Signed out or not synced yet: detect the tools directly.
    if (hostTargets.length === 0) ipc.skillsTargets().then(setOwnTargets, () => {});
  }, [hostTargets.length]);
  const me = useStore((s) => s.session?.user.name || s.session?.user.email || "팀원");


  const share = () => addDeviceSkillToTeam({ item, orgId, vaultSkills, me, onShared });

  const byline = [
    item.pluginName ? `${item.pluginName}${item.marketplace ? ` · ${item.marketplace}` : ""}${item.pluginVersion ? ` · v${item.pluginVersion}` : ""}` : usedByText(item) || null,
    item.pluginName ? null : tildePath(item.paths[0].slice(0, item.paths[0].lastIndexOf("/")), home),
    filesText(item),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="member-profile" aria-label={item.name}>
      <div className="skills-detail-head">
        <SkillIcon large />
        <div className="skills-detail-title">
          <div className="skills-title-row">
            <h2 className="settings-section-title">{skillDisplayName(item.name)}</h2>
            <span className="skills-source-pill">{deviceSourceLabel(item)}</span>
          </div>
          <p className="skills-byline" title={item.paths.map((p) => tildePath(p, home)).join("\n")}>
            {withTildes(byline)}
          </p>
        </div>
        <div className="skills-detail-controls">
          <AsyncButton className="secondary skills-hdr-btn" onClick={() => ipc.revealInFileManager(item.paths[0])}>
            {ipc.revealLabel()}
          </AsyncButton>
          {team ? (
            <button
              type="button"
              className="secondary skills-hdr-btn skills-shared-btn"
              title="팀에 이미 이 스킬이 있어요. 팀의 사본을 열어요."
              disabled={!onOpenTeamSkill}
              onClick={() => onOpenTeamSkill?.(team.id)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6.5" cy="5.25" r="2.5" />
                <path d="M1.75 13.5c0-2.5 2.1-4.25 4.75-4.25 1.2 0 2.3.35 3.1.95" />
                <path d="m10.5 11.5 1.5 1.5 3-3.25" />
              </svg>
              팀과 공유됨
            </button>
          ) : (
            canShare && (
              <BusyButton
                className="primary skills-hdr-btn"
                busyLabel="추가하는 중…"
                title="팀의 스킬에 추가하고 모든 멤버의 컴퓨터에 설치해요. 스킬 페이지에서 선택 설치로 바꿀 수 있어요."
                onClick={share}
              >
                팀에 추가
              </BusyButton>
            )
          )}
        </div>
      </div>
      <AvailableIn tools={deviceAvailability(item, detectedAiTools(targets))} />
      <DeviceSkillFiles path={item.paths[0]} />
    </section>
  );
}
