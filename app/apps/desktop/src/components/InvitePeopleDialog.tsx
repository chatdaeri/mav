import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { InviteManyResult, TeamAccessMode } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import { inviteWithVaultKeys, vaultKeysJoinCode } from "../lib/vaultKeys/runtime";
import { classifyLimitError, freeLimitOf, invitePrewarning, limitFromError, peopleLimitReason, type LimitKind } from "../lib/billing";
import { buildInviteLink } from "../lib/inviteLink";
import { isValidEmail, splitEmails } from "../lib/membersAccess";
import { useStore } from "../store";
import { AsyncButton } from "./AsyncButton";
import { LimitNudge } from "./LimitNudge";
import { PeopleLimitNotice, inviteLimitError, peopleLimitKind } from "./PeopleLimitNotice";
import { MenuSelect } from "./MenuSelect";
import { UpgradeDialog } from "./UpgradeDialog";

type InviteAccess = TeamAccessMode | "default";

const ACCESS_OPTIONS: ReadonlyArray<{ value: InviteAccess; label: string; hint?: string }> = [
  { value: "open", label: "편집 가능" },
  { value: "readonly", label: "보기 가능" },
  { value: "private", label: "접근 불가" },
  { value: "default", label: "볼트 기본값", hint: "새 멤버 설정을 따라요" },
];

/** Add typed or pasted text to the chip list, de-duplicated case-insensitively. */
export function addChips(chips: readonly string[], text: string): string[] {
  const seen = new Set(chips.map((c) => c.toLowerCase()));
  const out = [...chips];
  for (const email of splitEmails(text)) {
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
}

/**
 * Invite several people at once, each with a role and an access level. One
 * request; each address reports its own outcome, using the same three
 * messages the old Members tab showed (emailed / no email server / email
 * failed, with the link to share).
 */
export function InvitePeopleDialog({ orgId, vaultName = "이 볼트", newMembersAccess = null, onNewMembersAccess, canManageBilling = false, seatAccount = null, ownerName = null, onClose, onInvited }: {
  orgId: string;
  /** For the join-code sentence. */
  vaultName?: string;
  /** The vault's New members setting: what someone who joins by code gets. */
  newMembersAccess?: TeamAccessMode | null;
  /** Change the New members setting from the Join code tab (owners/admins). */
  onNewMembersAccess?: (mode: TeamAccessMode) => void;
  /** The owner can add seats from the notice. */
  canManageBilling?: boolean;
  /** The account's seats, for the warning shown before anyone types (Team model only). */
  seatAccount?: Parameters<typeof invitePrewarning>[0] | null;
  /** The vault owner's name, so an admin knows whom to ask. */
  ownerName?: string | null;
  onClose: () => void;
  /** Called with the per-address results so the roster can add rows at once. */
  onInvited: (results: InviteManyResult[], sent: { role: string; access: TeamAccessMode | null }) => void;
}) {
  const serverUrl = useStore((s) => s.serverUrl);
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [access, setAccess] = useState<InviteAccess>("default");
  const [code, setCode] = useState<string | null>(null);
  const shortCode = code ? code.split("-")[0]! : "";
  const [results, setResults] = useState<InviteManyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ kind: LimitKind; limit: number | null } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [peopleErr, setPeopleErr] = useState<unknown>(null);
  // Redesign: email and join code each get a tab of their own.
  const [tab, setTab] = useState<"email" | "code">("email");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    authManager.api
      .getJoinCode()
      .then((c) => vaultKeysJoinCode(orgId, c))
      .then((c) => { if (live) setCode(c); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !upgradeOpen) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, upgradeOpen]);

  const commitDraft = () => {
    if (!draft.trim()) return;
    setChips((c) => addChips(c, draft));
    setDraft("");
  };

  const all = draft.trim() ? addChips(chips, draft) : chips;
  const invalid = all.filter((e) => !isValidEmail(e));

  const send = async () => {
    setError(null);
    setLimit(null);
    setPeopleErr(null);
    if (all.length === 0 || invalid.length > 0) return;
    setChips(all);
    setDraft("");
    try {
      const out = await inviteWithVaultKeys(orgId, {
        emails: all,
        role,
        access: access === "default" ? null : access,
      });
      setResults(out);
      setChips(out.filter((r) => r.error).map((r) => r.email));
      onInvited(out, { role, access: access === "default" ? null : access });
      void useStore.getState().refreshVault();
    } catch (e) {
      const kind = classifyLimitError(e);
      if (peopleLimitKind(e)) setPeopleErr(e);
      else if (kind) setLimit({ kind, limit: limitFromError(e) });
      else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const prewarning = seatAccount ? invitePrewarning(seatAccount, ownerName, canManageBilling) : null;

  // A people limit is ONE notice, whether the whole call was refused or some
  // addresses were: the per-address rows below drop the raw code for it.
  const peopleNotice =
    peopleErr ?? results?.map((r) => (r.error ? inviteLimitError(r.error) : null)).find((x) => x != null) ?? null;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
  };
  const copyCode = async () => {
    if (!code) return;
    await copy(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="modal invite-people" role="dialog" aria-modal="true" aria-label="사람 초대" onClick={(e) => e.stopPropagation()}>
        <div className="invite-head">
          <h2 className="confirm-title">사람 초대</h2>
          <button type="button" className="invite-close" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <div className="invite-tabs" role="tablist" aria-label="초대 방법">
          <button type="button" role="tab" aria-selected={tab === "email"} className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>이메일로</button>
          <button type="button" role="tab" aria-selected={tab === "code"} className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>참여 코드</button>
        </div>
        {tab === "code" ? (
          <>
            <div className="invite-code-card">
              <p className="invite-code-lead">이 코드가 있는 사람은 누구나 {vaultName}에 참여할 수 있어요</p>
              {code ? (
                <>
                  {/* Tiles show the vault's 8-character code; a device that holds the
                      vault key appends `-<key>` (26 chars), which only travels by Copy. */}
                  <div className="invite-code-tiles" aria-label={`참여 코드 ${code}`}>
                    {shortCode.split("").map((ch, i) => (
                      <span key={i} className={i === Math.floor(shortCode.length / 2) ? "gap" : undefined}>{ch}</span>
                    ))}
                  </div>
                  {shortCode !== code && (
                    <p className="invite-code-note">복사해서 공유하세요. 복사한 코드에는 키가 포함되어 있어서 바로 들어올 수 있어요.</p>
                  )}
                </>
              ) : (
                <p className="invite-code-lead">코드를 불러오는 중…</p>
              )}
              <button type="button" className={`primary invite-copy${copied ? " is-copied" : ""}`} disabled={!code} onClick={() => void copyCode()}>
                {copied ? "복사됨" : "코드 복사"}
              </button>
            </div>
            <div className="invite-code-row">
              <span>
                참여한 사람의 권한
                <small>볼트의 새 멤버 설정</small>
              </span>
              {newMembersAccess && onNewMembersAccess ? (
                <MenuSelect<TeamAccessMode>
                  value={newMembersAccess}
                  options={ACCESS_OPTIONS.filter((o): o is { value: TeamAccessMode; label: string } => o.value !== "default")}
                  onSelect={onNewMembersAccess}
                  ariaLabel="참여한 사람의 권한"
                  triggerClassName="invite-field-trigger"
                  menuClassName="access-menu"
                />
              ) : (
                <span className="muted">{ACCESS_OPTIONS.find((o) => o.value === newMembersAccess)?.label ?? "새 멤버 설정"}</span>
              )}
            </div>
            <div className="invite-foot">
              <span className="invite-foot-hint">멤버로 참여해요.</span>
              <button type="button" className="ghost-pill" onClick={onClose}>완료</button>
            </div>
          </>
        ) : (<>
        <div className="invite-chips" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
          {chips.map((c) => (
            <span key={c} className={`invite-chip${isValidEmail(c) ? "" : " is-invalid"}`}>
              {c}
              <button type="button" aria-label={`${c} 제거`} onClick={() => setChips((cs) => cs.filter((x) => x !== c))}>×</button>
            </span>
          ))}
          <input
            type="text"
            autoFocus
            value={draft}
            placeholder={chips.length ? "" : "이메일 주소를 쉼표로 구분해 입력"}
            aria-label="이메일 주소"
            onChange={(e) => {
              const v = e.target.value;
              if (/[\s,;]$/.test(v)) { setChips((c) => addChips(c, v)); setDraft(""); }
              else setDraft(v);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!/[\s,;]/.test(text)) return;
              e.preventDefault();
              setChips((c) => addChips(c, draft + text));
              setDraft("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
              else if (e.key === "Backspace" && !draft && chips.length) setChips((c) => c.slice(0, -1));
            }}
            onBlur={commitDraft}
          />
        </div>
        {invalid.length > 0 && (
          <div className="auth-error">{invalid.length === 1 ? `“${invalid[0]}”은(는) 이메일 주소가 아니에요.` : `이메일 주소가 아닌 항목이 ${invalid.length}개 있어요.`}</div>
        )}
        <div className="invite-people-fields">
          <label className="invite-field">
            <span className="invite-field-label">역할</span>
            <MenuSelect
              value={role}
              options={[{ value: "member", label: "멤버" }, { value: "admin", label: "관리자", hint: "멤버와 권한을 관리할 수 있어요" }]}
              onSelect={setRole}
              ariaLabel="역할"
              triggerClassName="invite-field-trigger"
              menuClassName="access-menu"
              anchorClosest=".invite-field"
            />
          </label>
          <label className="invite-field">
            <span className="invite-field-label">권한</span>
            <MenuSelect
              value={access}
              options={ACCESS_OPTIONS}
              onSelect={setAccess}
              ariaLabel="권한"
              triggerClassName="invite-field-trigger"
              menuClassName="access-menu"
              anchorClosest=".invite-field"
              disabled={role === "admin"}
            />
          </label>
        </div>
        {error && <div className="auth-error">{error}</div>}
        {prewarning && !results && peopleNotice == null && (
          <div className="limit-nudge">
            <span>{prewarning.text}</span>
            {prewarning.action === "add-seats" && (
              <button type="button" className="link-btn" onClick={() => useStore.getState().requestAccountSettings("plan")}>
                좌석 추가
              </button>
            )}
            {prewarning.action === "upgrade" && (
              <button
                type="button"
                className="link-btn"
                onClick={() => useStore.getState().requestUpgradeDialog({ reason: peopleLimitReason(seatAccount ? freeLimitOf(seatAccount) : null) })}
              >
                업그레이드 →
              </button>
            )}
          </div>
        )}
        {peopleNotice != null && <PeopleLimitNotice error={peopleNotice} canManageBilling={canManageBilling} ownerName={ownerName} freeLimit={seatAccount ? freeLimitOf(seatAccount) : null} />}
        {limit && <LimitNudge kind={limit.kind} limit={limit.limit} onUpgrade={() => setUpgradeOpen(true)} />}
        {results?.map((r) => {
          const link = r.invitationId ? buildInviteLink(serverUrl, r.invitationId) : null;
          return (
            <div key={r.email} className={`invite-notice${r.error ? " is-warning" : ""}`}>
              {r.emailed ? (
                <span>{r.email}(으)로 초대 메일을 보냈어요.</span>
              ) : !r.invitationId ? (
                <span>{r.email}을(를) 초대하지 못했어요{r.error && !inviteLimitError(r.error) ? ` (${r.error})` : ""}.</span>
              ) : (
                <>
                  <span>
                    {r.error
                      ? `초대를 만들었지만 ${r.email}(으)로 메일을 보내지 못했어요 (${r.error}). 대신 이 링크를 공유하세요:`
                      : `초대를 만들었어요. 이 서버는 메일을 보내지 않으므로 ${r.email}에게 이 링크를 공유하세요:`}
                  </span>
                  {link && (
                    <div className="invite-notice-link">
                      <code>{link}</code>
                      <button className="link-btn" onClick={() => void copy(link)}>복사</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="invite-foot">
          <span className="invite-foot-hint">링크가 담긴 메일이 전송돼요.</span>
          <div className="confirm-actions invite-people-actions">
            <button type="button" className="ghost-pill" onClick={onClose}>{results ? "완료" : "취소"}</button>
            <AsyncButton
              className="primary"
              spinnerTone="on-accent"
              disabled={all.length === 0 || invalid.length > 0}
              onClick={send}
            >
              {all.length >= 2 ? `초대 ${all.length}건 보내기` : "초대 보내기"}
            </AsyncButton>
          </div>
        </div>
        </>)}
        {upgradeOpen && <UpgradeDialog onClose={() => setUpgradeOpen(false)} />}
      </div>
    </div>,
    document.body,
  );
}
