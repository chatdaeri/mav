// Vault Settings → Skills: the vault's team catalog (docs/SKILLS.md §5.5).
// Owners and admins create, upload, edit and publish; members see what is
// published and turn Optional skills on for their own computer.

import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { authManager } from "../../lib/auth/authManager";
import { skillErrorCode } from "../../lib/api";
import * as ipc from "../../lib/ipc";
import { serverFeatures } from "../../lib/serverFeatures";
import { checkSkillsNow, isSkillOnThisDevice, setSkillOnThisDevice, showDeliveryNow, SKILLS_FEATURE, useSkillsChanged, useSkillsDeviceState } from "../../lib/skills/syncHost";
import { groupSkills, type SkillGroup } from "../../lib/skills/grouping";
import { countLive, deviceItems } from "../../lib/skills/deviceGrouping";
import { deviceSeen, scanDevice, useDeviceScan } from "../../lib/skills/deviceScan";
import { AI_TOOL_NAME, detectedAiTools, overallState, stateLines, targetStates, teamAvailability } from "../../lib/skills/installState";
import { loadSkillsPrefs } from "../../lib/skills/prefs";
import { skillDisplayName } from "../../lib/skills/display";
import type { SkillFileInput, SkillsCatalog, SkillSummary } from "../../lib/skills/types";
import {
  base64ToText,
  isValidSkillName,
  parseSkillFrontmatter,
  textToBase64,
  suggestSkillName, CAP_RULE_TEXT } from "../../lib/skills/validate";
import { toast } from "../../lib/toast";
import { useStore } from "../../store";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarketplaceBrowser } from "./MarketplaceBrowser";
import { AudienceStack, RefreshIcon, EmptyState, SkillCard, SkillGlyph, UploadGlyph, GitHubGlyph, InstallButton, LoadError, SearchToggle, SkillGridSkeleton, skillAuthor } from "./parts";
import { Spinner } from "../Spinner";
import { withTimeout } from "../../lib/skills/loading";
import { primeCatalog } from "../../lib/skills/catalogCache";
import { ToolLogo, WorksWith } from "./ToolLogos";
import { DeviceSkillsView } from "./DeviceSkillsView";
import { NewSkillDialog } from "./NewSkillDialog";
import { downloadSkillZip, SkillDetail } from "./SkillDetail";
import { RemoveFromTeamDialog } from "./RemoveFromTeamDialog";
import { RowActionsMenu } from "../RowActionsMenu";
import { SkillsMenuButton } from "./SkillsMenuButton";
import { takeUnseenSkills, useHighlightSkill } from "./useHighlightSkill";
import { useScrollReset } from "./useScrollReset";
import { SKILL_FILE_EXTS, useSkillFileDrop } from "./useSkillFileDrop";
import { claimFileDrops } from "../../lib/dropClaim";
import { myAccessOf } from "../../lib/skills/access";
import "./skills.css";

const ERROR_TEXT: Record<string, string> = {
  invalid_name: "스킬 이름은 소문자, 숫자, 하이픈 하나로만 만들 수 있어요.",
  skill_name_taken: "같은 이름의 스킬이 이미 있어요.",
  skill_limit_reached: "이 볼트에 담을 수 있는 최대 스킬 수(500개)에 도달했어요.",
  ...CAP_RULE_TEXT,
  payload_too_large: "스킬이 너무 커서 업로드할 수 없어요.",
  invalid_path: "사용할 수 없는 파일 이름이 있어요.",
};

function errorText(e: unknown): string {
  const code = skillErrorCode(e);
  return (code && ERROR_TEXT[code]) ?? (e instanceof Error ? e.message : String(e));
}

interface PendingUpload {
  name: string;
  files: SkillFileInput[];
  skipped: string[];
  existing: SkillSummary | null;
}

/** Popular public sources offered as one-click starts. */
const POPULAR_SOURCES = ["anthropics/skills", "openai/skills", "BenAIOS/skills"];

/** List or grid, remembered per device (the Members Access tab's toggle). */
/** Team catalog or this computer's skills, remembered per device. */
type SkillsScope = "team" | "device";
/** How long a removed card fades before the reload drops it (skills.css `.is-leaving`). */
const LEAVE_MS = 220;

const SCOPE_KEY = "context.skills.scope";

function readScope(): SkillsScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "device" ? "device" : "team";
  } catch {
    return "team";
  }
}

function writeScope(scope: SkillsScope) {
  try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* storage unavailable */ }
}

function ScopeToggle({
  value,
  onChange,
  teamCount,
  deviceCount,
  showDot,
}: {
  value: SkillsScope;
  onChange: (v: SkillsScope) => void;
  teamCount: number | null;
  /** null while the first scan of this computer runs. */
  deviceCount: number | null;
  /** First visit not made yet on this computer. */
  showDot: boolean;
}) {
  const option = (scope: SkillsScope, label: string, count: number | null, extra?: React.ReactNode, title?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === scope}
      title={title}
      className={`member-access-view-btn skills-scope-btn${value === scope ? " is-active" : ""}`}
      onClick={() => { if (value !== scope) onChange(scope); }}
    >
      {label}
      {/* Distinct keys: reused in place, WebKit kept spinning the number. */}
      {count === null ? (
        <span key="spin" className="spinner spinner-xs spinner-inherit skills-scope-spin" aria-label="세는 중" />
      ) : (
        <span key="count" className="skills-chip-count">{count}</span>
      )}
      {extra}
    </button>
  );
  return (
    <div className="member-access-view" role="radiogroup" aria-label="스킬 범위">
      {option("team", "팀", teamCount)}
      {option(
        "device",
        "이 기기",
        deviceCount,
        showDot ? <span className="skills-new-dot" aria-hidden="true" /> : null,
        showDot ? "이 컴퓨터의 AI 도구에 있는 모든 스킬 보기" : undefined,
      )}
    </div>
  );
}

export function SkillsTab({ canManage, resetToken }: { canManage: boolean; resetToken: number }) {
  const orgId = useStore((s) => s.session?.activeOrganizationId ?? null);
  const serverUrl = useStore((s) => s.serverUrl);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<SkillsCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The marketplace page, optionally opening a repo straight away. */
  const [marketplace, setMarketplace] = useState<{ preload?: string } | null>(null);
  const [scope, setScope] = useState<SkillsScope>(readScope);
  const [loadFailed, setLoadFailed] = useState(false);
  /** "파일을 읽는 중…" then "업로드하는 중…" while a .zip goes up. */
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  // Started quietly on open, so the toggle can count this computer's skills.
  const deviceScan = useDeviceScan();
  /** A folder of this name on this computer that isn't a team copy: the original it was added from. */
  const ownFolderHere = (name: string) =>
    deviceScan.status === "ready" &&
    deviceScan.entries.some((e) => !e.managed && !e.pluginName && e.name.toLowerCase() === name.toLowerCase());
  const [seen, setSeen] = useState(deviceSeen);
  /** Optional skills just turned on here, until the run reports them. */
  const [installing, setInstalling] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<SkillSummary | null>(null);
  // Admin "Remove from team" from a card's ⋯; the card fades out before the reload drops it.
  const [teamRemoving, setTeamRemoving] = useState<SkillSummary | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");

  // Ring and tag a just-added skill once the Team grid is showing.
  const { highlight, seen: seenNew, ringIds, newIds, pending: highlightPending } = useHighlightSkill(!openId && !marketplace && scope === "team" && !!catalog);
  /** A device skill's page is open inside "On this device" (no footer there). */
  const [devicePage, setDevicePage] = useState(false);
  /** Bumped by the top "← On this device" link to close a device skill's page. */
  const [closePage, setClosePage] = useState(0);
  // Each view opens at the top; a grid comes back where it was.
  const viewKey = openId ? `skill:${openId}` : marketplace ? "marketplace" : scope === "device" && devicePage ? "device-page" : `grid:${scope}`;
  const rememberGridScroll = useScrollReset(viewKey, highlightPending);
  /** Groups the person flipped from their default (the first open, the rest closed). */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const device = useSkillsDeviceState();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [, setPrefsTick] = useState(0);

  useEffect(() => {
    setOpenId(null);
    setMarketplace(null);
  }, [resetToken]);

  useEffect(() => {
    let cancelled = false;
    void serverFeatures(serverUrl, () => authManager.api.getHealth(serverUrl)).then((f) => {
      // An empty set is "unknown" (unreachable): try the catalog anyway.
      if (!cancelled) setSupported(f.size === 0 || f.has(SKILLS_FEATURE));
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const next = await withTimeout(authManager.api.listSkills(orgId));
      setCatalog(next);
      primeCatalog(orgId, next);
      setError(null);
      setLoadFailed(false);
      // Everyone, not only whoever added it: a skill new to this device glows.
      const fresh = takeUnseenSkills(`${serverUrl}|${orgId}`, next.skills.map((k) => k.id));
      if (fresh.length > 0) highlight(fresh);
    } catch (e) {
      setError(errorText(e));
      setLoadFailed(true);
    }
  }, [orgId, serverUrl, highlight]);

  useEffect(() => {
    if (supported) void reload();
  }, [supported, reload]);
  // A teammate's add, publish or removal shows here as it happens.
  useSkillsChanged(supported ? orgId : null, () => void reload());

  // No file dropped anywhere in Skills reaches the vault: the file tree
  // stands aside while this tab is open, whatever page of it is showing.
  useEffect(() => claimFileDrops(), []);
  // Dropping a .zip or .skill on the Team grid uploads it (admins only).
  const dropFile = useRef<(path: string) => void>(() => {});
  const canDrop =
    !!orgId && !!supported && !!catalog && (canManage || catalog.role === "owner" || catalog.role === "admin") &&
    scope === "team" && !openId && !marketplace && !creating && !pending && !uploadPhase;
  const dragging = useSkillFileDrop(
    canDrop,
    (path) => dropFile.current(path),
    (paths) => {
      const name = paths[0].split(/[\\/]/).pop() ?? "그 파일";
      toast(`${paths.length > 1 ? "해당 파일은" : `${name}은(는)`} 스킬이 아니에요. .zip 또는 .skill 파일을 놓아 주세요.`, "error");
    },
  );

  if (!orgId) return <div className="muted perm-empty">스킬을 쓰려면 동기화된 볼트가 필요해요.</div>;
  if (supported === false) {
    return (
      <>
        <h2 className="settings-section-title">에이전트 스킬</h2>
        <div className="muted">스킬을 관리하려면 서버를 업데이트해야 해요.</div>
      </>
    );
  }

  const manage = canManage || catalog?.role === "owner" || catalog?.role === "admin";

  if (marketplace && !openId) {
    return (
      <MarketplaceBrowser
        orgId={orgId}
        vaultSkills={catalog?.skills ?? []}
        preload={marketplace.preload}
        onBack={() => setMarketplace(null)}
        onOpenSkill={setOpenId}
        onCatalogChanged={reload}
        onImported={highlight}
      />
    );
  }

  if (openId) {
    return (
      <SkillDetail
        orgId={orgId}
        skillId={openId}
        canManage={manage}
        onBack={() => {
          setOpenId(null);
          void reload();
        }}
        onChanged={() => void reload()}
      />
    );
  }

  /**
   * A new team skill starts Required, like shared and imported ones: set on the
   * draft, so its first publish installs it for everyone. A refusal leaves it
   * Optional, which the skill's page can still change.
   */
  const startRequired = async (skillId: string) => {
    try {
      await authManager.api.patchSkill(orgId, skillId, { delivery: "required" });
    } catch {
      /* stays Optional */
    }
  };

  /** New skill: a SKILL.md with the given description (or the server's starter), then its page. */
  const create = async (name: string, description: string): Promise<string | null> => {
    if (!isValidSkillName(name)) return ERROR_TEXT.invalid_name;
    // A double-quoted YAML scalar is a JSON string, so any description is safe here.
    const files = description
      ? [{ path: "SKILL.md", contentBase64: textToBase64(`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n`) }]
      : undefined;
    try {
      const created = await authManager.api.createSkill(orgId, name, files);
      await startRequired(created.id);
      setCreating(false);
      await reload();
      highlight(created.id);
      setOpenId(created.id);
      return null;
    } catch (e) {
      return errorText(e);
    }
  };

  const uploadZip = async () => {
    const picked = await openDialog({ multiple: false, filters: [{ name: "스킬", extensions: SKILL_FILE_EXTS }] });
    if (!picked || Array.isArray(picked)) return;
    await uploadZipAt(picked);
  };

  /** A .zip or .skill (picked, or dropped on the page) becomes a new skill or a draft. */
  const uploadZipAt = async (picked: string) => {
    setError(null);
    let bundle: ipc.SkillBundle;
    setUploadPhase("파일을 읽는 중…");
    try {
      bundle = await ipc.skillsReadZip(picked);
    } catch (e) {
      setUploadPhase(null);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setUploadPhase(null);
    // The SKILL.md name wins when it is a valid one: publish requires the two to match.
    const md = bundle.files.find((f) => f.path === "SKILL.md");
    const fm = md ? parseSkillFrontmatter(base64ToText(md.contentBase64) ?? "") : null;
    const name = fm?.ok && isValidSkillName(fm.name) ? fm.name : suggestSkillName(bundle.suggestedName);
    if (!isValidSkillName(name)) {
      setError(`"${bundle.suggestedName}"은(는) 스킬 이름으로 쓸 수 없어요. SKILL.md에서 이름을 지정하세요.`);
      return;
    }
    const files = bundle.files.map((f) => ({
      path: f.path,
      contentBase64: f.contentBase64,
      executable: f.executable,
      sha256: f.sha256,
    }));
    const existing = catalog?.skills.find((s) => s.name === name) ?? null;
    const next = { name, files, skipped: bundle.skipped, existing };
    if (existing) setPending(next);
    else await applyUpload(next);
  };

  dropFile.current = (path) => void uploadZipAt(path);

  const applyUpload = async (u: PendingUpload) => {
    setUploadPhase("업로드하는 중…");
    try {
      let id: string;
      if (u.existing) {
        const detail = await authManager.api.getSkill(orgId, u.existing.id);
        await authManager.api.putSkillDraft(orgId, u.existing.id, detail.draftRevision, u.files);
        id = u.existing.id;
      } else {
        id = (await authManager.api.createSkill(orgId, u.name, u.files)).id;
        await startRequired(id);
      }
      toast(
        u.skipped.length
          ? `${u.name}을(를) 업로드했어요. 파일 ${u.skipped.length}개는 제외했어요: ${u.skipped.slice(0, 3).join(", ")}${u.skipped.length > 3 ? "…" : ""}`
          : `${u.name}을(를) 업로드했어요. 준비되면 게시하세요.`,
        "neutral",
      );
      await reload();
      highlight(id);
      setOpenId(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploadPhase(null);
    }
  };

  const skills = catalog?.skills ?? [];
  const targetsOn = loadSkillsPrefs().targets;
  const groups = groupSkills(skills, filter);
  const newMenu = [
    { key: "write", label: "처음부터 작성", onSelect: () => setCreating(true) },
    { key: "zip", label: ".zip 또는 .skill 업로드", onSelect: () => uploadZip() },
  ];
  const toggleGroup = (key: string) =>
    setFlipped((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** This computer's side of one skill: the tool cluster and the install square. */
  /** A Required ✓'s "Make optional" (admins): the same PATCH as the skill page's select. */
  const makeOptional = async (s: SkillSummary) => {
    // The card flips now; a refused PATCH puts it back.
    const undo = showDeliveryNow(orgId, s.id, "optional");
    setCatalog((c) => (c ? { ...c, skills: c.skills.map((k) => (k.id === s.id ? { ...k, delivery: "optional" } : k)) } : c));
    try {
      await authManager.api.patchSkill(orgId, s.id, { delivery: "optional" });
    } catch (e) {
      undo();
      void reload();
      throw e;
    }
    toast(`${skillDisplayName(s.name)}은(는) 이제 선택 사항이에요. 각자 컴퓨터에서 제거할 수 있어요.`);
    void reload();
  };

  const install = (s: SkillSummary) => {
    if (s.effectiveVersion === null) return { button: null };
    const states = targetStates(device.results, targetsOn, orgId, s.id);
    const overall = overallState(states);
    const lines = stateLines(states, s.effectiveVersion).join("\n");
    // An owner/admin sees every skill, but only one shared with them installs here.
    const mine = myAccessOf(s);
    if (mine === "none") {
      return { button: <InstallButton kind="blocked" title={"나에게 공유되지 않음\n스킬을 관리하는 사람이라 보이는 거예요"} /> };
    }
    const optional = mine === "optional";
    const optedIn = !optional || isSkillOnThisDevice(serverUrl, orgId, s.id);
    let button: React.ReactNode;
    if (installing.has(s.id) && overall === "none") {
      button = <InstallButton kind="busy" title="이 컴퓨터에 설치하는 중…" />;
    } else if (optedIn && (overall === "warn" || overall === "bad")) {
      button = <InstallButton kind={overall} title={`${lines}\n열어서 해결하세요`} onClick={() => setOpenId(s.id)} />;
    } else if (!optional) {
      button = (
        <InstallButton
          kind="required"
          title={`팀 필수 스킬\n${lines}`}
          name={s.name}
          canManage={manage}
          onMakeOptional={manage ? () => makeOptional(s) : undefined}
        />
      );
    } else if (optedIn) {
      button = <InstallButton kind="installed" title={`이 컴퓨터에 설치됨 · 눌러서 제거\n${lines}`} onClick={() => setRemoving(s)} />;
    } else {
      button = (
        <InstallButton
          kind="install"
          title="이 컴퓨터에서 사용"
          onClick={() => {
            setInstalling((p) => new Set(p).add(s.id));
            // A run that never reports (both folders off, say) stops spinning.
            setTimeout(() => setInstalling((p) => {
              const next = new Set(p);
              next.delete(s.id);
              return next;
            }), 20_000);
            setSkillOnThisDevice(orgId, s.id, true);
            setPrefsTick((n) => n + 1);
          }}
        />
      );
    }
    return { button };
  };

  /** "By Sara Lee · v2 · Required" or "anthropics/skills · v1 · Optional". */
  const metaLine = (s: SkillSummary, withAuthor: boolean) => {
    const author = skillAuthor(s);
    const who = s.source ? s.source.repo : author ? `${author.name} 작성` : null;
    const parts = [
      ...(withAuthor && who ? [who] : []),
      s.effectiveVersion !== null ? `v${s.effectiveVersion}${s.pinnedVersion !== null ? " (고정됨)" : ""}` : null,
      // Cards say who and which version; Required/Optional is in the ✓ tooltip.
      ...(withAuthor ? [] : [s.delivery === "required" ? "필수" : "선택"]),
    ].filter(Boolean);
    return (
      <span className="skills-meta-line">
        {s.effectiveVersion === null && <span className="skills-meta-warn">게시 안 됨 · </span>}
        {parts.join(" · ")}
      </span>
    );
  };

  /** The AI tools that use this skill on this computer, as small marks (none when it isn't here). */
  const toolsHere = (s: SkillSummary) => {
    if (s.effectiveVersion === null) return null;
    const mine = myAccessOf(s);
    if (mine === "none") return null;
    const optedIn = mine === "required" || isSkillOnThisDevice(serverUrl, orgId, s.id);
    const on = teamAvailability(targetStates(device.results, targetsOn, orgId, s.id), optedIn, detectedAiTools(device.targets)).filter(
      (t) => t.on,
    );
    if (on.length === 0) return null;
    return (
      <span className="skills-card-tools" aria-label={`이 컴퓨터에서 ${on.map((t) => AI_TOOL_NAME[t.tool]).join(", ")}가 사용 중`}>
        {on.map((t) => (
          <ToolLogo key={t.tool} tool={t.tool} size={14} title={`이 컴퓨터에서 ${AI_TOOL_NAME[t.tool]}가 사용 중`} />
        ))}
      </span>
    );
  };

  const openProps = (s: SkillSummary) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => {
      seenNew(s.id);
      setOpenId(s.id);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") setOpenId(s.id);
    },
  });

  const groupBody = (g: SkillGroup) => (
      <ul className="skills-grid">
        {g.skills.map((s) => (
          <SkillCard
            key={s.id}
            name={s.name}
            titleExtra={newIds.has(s.id) && <span className="skills-new-chip">새로움</span>}
            byline={metaLine(s, true)}
            description={s.description || "아직 설명이 없어요."}
            footer={
              <>
                {toolsHere(s)}
                {s.sharedWith && <AudienceStack audience={s.sharedWith} viewerIn={myAccessOf(s) !== "none"} />}
              </>
            }
            action={install(s).button}
            className={`${ringIds.has(s.id) ? "is-highlight" : ""}${leaving.has(s.id) ? " is-leaving" : ""}`.trim()}
            li={{ "data-skill-id": s.id, ...openProps(s) }}
            more={
              manage && (
                <RowActionsMenu
                  ariaLabel={`${skillDisplayName(s.name)} 더 보기`}
                  actions={[
                    { key: "open", label: "열기", onSelect: () => openProps(s).onClick() },
                    ...(s.effectiveVersion !== null
                      ? [{ key: "zip", label: ".zip 다운로드", onSelect: () => downloadSkillZip(orgId, s.id, s.name, s.effectiveVersion!) }]
                      : []),
                    { key: "remove", label: "팀에서 제거", danger: true, separated: true, onSelect: () => setTeamRemoving(s) },
                  ]}
                />
              )
            }
          />
        ))}
      </ul>
  );

  return (
    <>
      {/* Fades in whenever it mounts again: back from the marketplace or a skill's page. */}
      <div className="skills-scroll skills-view-in" onScroll={(e) => rememberGridScroll(viewKey, e.currentTarget.scrollTop)}>
      {scope === "device" && devicePage && (
        // A device skill's page is a sub-page: its way back comes first, like a member's page.
        <button type="button" className="link-btn member-profile-back" onClick={() => setClosePage((n) => n + 1)}>
          ← On this device
        </button>
      )}
      <div className="members-access-header skills-page-head">
        <div>
          <h2 className="settings-section-title">에이전트 스킬</h2>
          <p className="skills-intro">팀의 AI 도구에 일하는 방식을 가르쳐 보세요.</p>
        </div>
        {(catalog || !loadFailed) && (
          <div className="skills-actions">
            {uploadPhase && (
              <span className="skills-upload-status" role="status">
                <Spinner size="xs" /> {uploadPhase}
              </span>
            )}
            {/* Each tab's own buttons stay mounted and fold in or out, so on a
                switch they fade while search and the toggle glide aside. */}
            <span className={`skills-hdr-slot is-start${scope === "device" && !devicePage ? "" : " is-folded"}`} aria-hidden={scope !== "device" || undefined}>
              <span className="member-access-view">
                <button
                  type="button"
                  className={`member-access-view-btn skills-refresh-btn${deviceScan.status === "loading" || (deviceScan.status === "ready" && deviceScan.refreshing) ? " is-spinning" : ""}`}
                  disabled={scope !== "device" || deviceScan.status === "loading" || (deviceScan.status === "ready" && !!deviceScan.refreshing)}
                  tabIndex={scope === "device" ? undefined : -1}
                  onClick={() => void scanDevice(true)}
                  aria-label="이 컴퓨터의 스킬 다시 찾아보기"
                  title="새로 고침"
                >
                  <RefreshIcon />
                </button>
              </span>
            </span>
            <SearchToggle
              value={filter}
              onChange={setFilter}
              placeholder={scope === "device" ? "이 컴퓨터에서 검색" : "스킬 검색"}
              hotkeys
            />
            <ScopeToggle
              value={scope}
              onChange={(v) => {
                setScope(v);
                writeScope(v);
                if (v === "device") setSeen(true);
              }}
              teamCount={catalog ? skills.length : null}
              deviceCount={deviceScan.status === "ready" ? countLive(deviceItems(deviceScan.entries)) : deviceScan.status === "error" ? 0 : null}
              showDot={!seen && scope !== "device"}
            />
            {manage && skills.length > 0 && (
              <span className={`skills-hdr-slot is-end${scope === "team" ? "" : " is-folded"}`} aria-hidden={scope !== "team" || undefined}>
                <button className="secondary skills-hdr-btn" tabIndex={scope === "team" ? undefined : -1} onClick={() => setMarketplace({})}>
                  마켓플레이스 둘러보기
                </button>
                <SkillsMenuButton label="새 스킬" className="primary skills-hdr-btn" actions={newMenu} />
              </span>
            )}
          </div>
        )}
      </div>

      {error && !loadFailed && <div className="auth-error">{error}</div>}

      {loadFailed && !catalog ? (
        <LoadError message={`이 볼트의 스킬을 불러오지 못했어요: ${error ?? ""}`} onRetry={() => void reload()} />
      ) : scope === "device" ? (
        <DeviceSkillsView
          onPageChange={setDevicePage}
          closePage={closePage}
          onOpenTeamSkill={(id) => {
            setScope("team");
            writeScope("team");
            setOpenId(id);
          }}
          onAddedHere={(id) => {
            void reload();
            checkSkillsNow();
            // Glows on the Team grid when they go back to it.
            highlight(id);
          }}
          filter={filter}
          orgId={orgId}
          canShare={manage}
          vaultSkills={skills}
          onShared={(id) => {
            // Land on the Team grid with the new card ringed, not on its page,
            // and sync now so the person's own folder is adopted at once
            // rather than showing "Name taken" until the next poll.
            void reload();
            checkSkillsNow();
            setScope("team");
            writeScope("team");
            highlight(id);
          }}
        />
      ) : !catalog && !error ? (
        <SkillGridSkeleton />
      ) : skills.length === 0 ? (
        manage ? (
          <EmptyState
            title="아직 스킬이 없어요"
            page
            dropHint={
              <>
                <UploadGlyph /> 또는 .zip, .skill 파일을 여기에 놓으세요
              </>
            }
            actions={
              <>
                <button className="primary" onClick={() => setMarketplace({})}>마켓플레이스 둘러보기</button>
                <SkillsMenuButton label="스킬 만들기" className="secondary" actions={newMenu} />
              </>
            }
          >
            스킬을 추가하면 모든 멤버의 Claude, Codex, Cursor에 전달돼요.
            <span className="skills-chips">
              {POPULAR_SOURCES.map((repo) => (
                <button key={repo} type="button" className="skills-chip" onClick={() => setMarketplace({ preload: repo })}>
                  {repo}
                </button>
              ))}
            </span>
          </EmptyState>
        ) : (
          <EmptyState title="아직 스킬이 없어요" page>관리자가 아직 스킬을 게시하지 않았어요.</EmptyState>
        )
      ) : (
        <>
          {groups.length === 0 && <div className="field-hint skills-quiet">일치하는 스킬이 없어요.</div>}
          {groups.map((g, gi) => {
            // Only the first group starts open: "Shared with your team" when
            // there is one, else the first import source.
            const closedByDefault = gi > 0;
            // A search shows every match, and a just-added skill keeps its group open.
            const isCollapsed =
              closedByDefault !== flipped.has(g.key) && !filter.trim() && !g.skills.some((k) => ringIds.has(k.id));
            const label = (
              <>
                {g.kind === "source" ? <GitHubGlyph /> : null}
                <span>{g.label}</span>
                <span className="skills-group-count">{g.skills.length}</span>
              </>
            );
            return (
              <section key={g.key} className="skills-group">
                <button
                  type="button"
                  className="skills-group-head is-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(g.key)}
                >
                  <svg className={`skills-caret${isCollapsed ? " is-closed" : ""}`} viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {label}
                </button>
                {!isCollapsed && groupBody(g)}
              </section>
            );
          })}
          {manage && !filter.trim() && (
            // Says the grid takes a dropped file; a click picks one instead.
            <button type="button" className="skills-drop-strip" onClick={() => void uploadZip()}>
              <span className="skills-drop-strip-icon">
                <UploadGlyph />
              </span>
              <strong>.zip 또는 .skill 파일을 여기에 놓으세요</strong>
              <span>또는 눌러서 파일을 선택하세요 · 게시할 수 있는 초안이 돼요</span>
            </button>
          )}
        </>
      )}

      </div>
      {catalog && !(scope === "device" && devicePage) && <WorksWith />}

      {dragging && (
        <div className={`skills-drop-overlay${dragging === "refused" ? " is-refused" : ""}`} aria-hidden="true">
          <span className="skills-empty-icon">
            <SkillGlyph size={22} />
          </span>
          <strong>{dragging === "skill" ? "놓아서 이 스킬 추가" : ".zip 또는 .skill 파일만 가능해요"}</strong>
          <span>{dragging === "skill" ? "검토 후 게시할 수 있는 초안이 돼요." : "이 파일은 스킬로 추가할 수 없어요."}</span>
        </div>
      )}

      {teamRemoving && (
        <RemoveFromTeamDialog
          orgId={orgId}
          skill={teamRemoving}
          ownFolderHere={ownFolderHere(teamRemoving.name)}
          onCancel={() => setTeamRemoving(null)}
          onRemoved={() => {
            const id = teamRemoving.id;
            setTeamRemoving(null);
            setLeaving((prev) => new Set(prev).add(id));
            setTimeout(() => {
              void reload().finally(() =>
                setLeaving((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                }),
              );
            }, LEAVE_MS);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`이 컴퓨터에서 ${skillDisplayName(removing.name)}을(를) 제거할까요?`}
          confirmLabel="제거"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setSkillOnThisDevice(orgId, removing.id, false);
            setPrefsTick((n) => n + 1);
            setRemoving(null);
          }}
        >
          볼트에는 그대로 남아 있어서 언제든 다시 추가할 수 있어요. 직접 수정한 사본은 삭제되지 않고 유지돼요.
        </ConfirmDialog>
      )}

      {creating && (
        <NewSkillDialog
          takenNames={new Set(skills.map((k) => k.name.toLowerCase()))}
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={`${pending.name}의 초안을 바꿀까요?`}
          confirmLabel="초안 바꾸기"
          tone="accent"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const u = pending;
            setPending(null);
            await applyUpload(u);
          }}
        >
          업로드한 파일이 새 초안이 돼요. 게시하기 전까지 게시된 버전에는 영향이 없어요.
        </ConfirmDialog>
      )}
    </>
  );
}
