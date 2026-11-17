import { BILLING_UI } from "../lib/brand";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SERVER_URL, PRODUCTION_SERVER_URL } from "../lib/api";
import type { AccountSettingsTab } from "../lib/settingsTabs";
import { authManager } from "../lib/auth/authManager";
import { readRecentServers, switchServer } from "../lib/auth/recentServers";
import { normalizeServerUrl, serverHost } from "../lib/auth/serverChoice";
import {
  ACTIVITY_STATUSES,
  STATUS_MOMENTS,
  EDITOR_FONTS,
  type EditorFont,
  type ActivityStatus,
  writeServerChoice,
} from "../lib/prefs";
import type { PropertiesMode } from "../lib/editor/frontmatter";
import {
  checkAndAutoInstall,
  currentVersion,
  relaunchForUpdate,
  useUpdateState,
} from "../lib/updater";
import { useStore } from "../store";
import { updateView } from "../lib/updateView";
import appIcon from "../assets/brand/app-icon.png";
import {
  CHARACTER_PREFIX,
  PROFILE_CHARACTER_SEEDS,
  PROFILE_IMAGE_MAX_CHARS,
  PROFILE_IMAGE_PX,
} from "../lib/profileAvatar";
import { imageFileToSquareDataUrl } from "../lib/squareImage";
import { InstalledAgentsList } from "./DashboardAgentRunner";
import { AccountPlanTab } from "./AccountPlanTab";
import { AccountVaultsTab } from "./AccountVaultsTab";
import { AiToolsTab } from "./skills/AiToolsTab";
import { Avatar } from "./Avatar";
import { serverFailureMessage } from "./serverFailureMessage";
import { SecurityCodeField } from "./SecurityCodeField";
import { SettingsModal } from "./SettingsModal";
import { SettingsCrossLink } from "./SettingsCrossLink";
import { Switch } from "./Switch";
import { AppearanceRows } from "./AppearanceRows";
import { MenuSelect } from "./MenuSelect";
import { useShallow } from "zustand/react/shallow";
import {
  appearanceSource,
  type AppearanceKey,
  type AppearanceSettings,
} from "../lib/appearanceSettings";
import type { EditorMeasure } from "../lib/prefs";

/**
 * Account settings — a centered modal over the app (sibling to Vault settings,
 * and sharing its shell in {@link SettingsModal}) for everything that follows
 * the *user* rather than any one vault: profile (name/avatar), activity status,
 * appearance, notifications, the server it syncs against, and app updates.
 * Profile fields are server-backed (Better Auth) so they follow the account
 * across devices; status/notifications/theme/server are device-local
 * preferences.
 */

type AccountTab = AccountSettingsTab;

const ACCOUNT_TABS: Array<{ id: AccountTab; label: string; icon: React.ReactNode }> = [
  {
    id: "profile",
    label: "프로필",
    icon: (
      <Icon>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </Icon>
    ),
  },
  {
    id: "status",
    label: "활동 상태",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      </Icon>
    ),
  },
  {
    id: "plan",
    label: "요금제 및 결제",
    icon: (
      <Icon>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </Icon>
    ),
  },
  {
    id: "vaults",
    label: "볼트",
    icon: (
      <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </Icon>
    ),
  },
  {
    id: "appearance",
    label: "화면",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10" />
      </Icon>
    ),
  },
  {
    id: "notifications",
    label: "알림",
    icon: (
      <Icon>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </Icon>
    ),
  },
  {
    id: "ai-tools",
    label: "AI 도구",
    icon: (
      <Icon>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </Icon>
    ),
  },
  {
    id: "connection",
    label: "연결",
    icon: (
      <Icon>
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <path d="M6 6h.01M6 18h.01" />
      </Icon>
    ),
  },
  {
    id: "about",
    label: "정보",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </Icon>
    ),
  },
];

export function AccountSettings({
  onClose,
  initialTab,
}: {
  onClose: () => void;
  initialTab?: AccountSettingsTab;
}) {
  const session = useStore((s) => s.session);
  const [tab, setTab] = useState<AccountTab>(initialTab ?? "profile");
  const vaultOpen = useStore((s) => s.vault !== null);

  // Esc, click-away, focus and the backdrop all live in `SettingsModal`.
  if (!session) return null;
  const activeTab = ACCOUNT_TABS.find((t) => t.id === tab)!;
  const userLabel = session.user.name || session.user.email;

  return (
    <SettingsModal label="계정 설정" onClose={onClose}>
      <header className="settings-page-header">
        <div className="settings-title">
          <span className="settings-eyebrow">계정 설정</span>
          <h1>{userLabel}</h1>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="설정 닫기" title="닫기 (Esc)">
          ✕
        </button>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="계정 설정 구역">
          {ACCOUNT_TABS.filter((t) => BILLING_UI || t.id !== "plan").map((t) => (
            <button
              key={t.id}
              type="button"
              className={`menu-item${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              <span className="menu-item-label">{t.label}</span>
            </button>
          ))}
          {vaultOpen && (
            <SettingsCrossLink
              label="볼트 설정"
              onOpen={() => useStore.getState().requestSettings("general")}
            />
          )}
        </nav>

        <section key={tab} className="settings-content rd-tab-in" aria-label={activeTab.label}>
          <h2 className="settings-section-title">{activeTab.label}</h2>
          {tab === "profile" ? (
            <ProfileTab />
          ) : tab === "status" ? (
            <StatusTab />
          ) : tab === "plan" ? (
            <AccountPlanTab />
          ) : tab === "vaults" ? (
            <AccountVaultsTab />
          ) : tab === "appearance" ? (
            <AppearanceTab />
          ) : tab === "notifications" ? (
            <NotificationsTab />
          ) : tab === "ai-tools" ? (
            <AiToolsTab />
          ) : tab === "connection" ? (
            <ConnectionTab />
          ) : (
            <AboutTab onClose={onClose} />
          )}
        </section>
      </div>
    </SettingsModal>
  );
}

function ProfileTab() {
  const session = useStore((s) => s.session);
  const [name, setName] = useState(session?.user.name ?? "");
  const [image, setImage] = useState(session?.user.image ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // While the name field has focus, a session refresh (our own save landing)
  // must not overwrite what is still being typed.
  const nameFocused = useRef(false);

  useEffect(() => {
    if (!nameFocused.current) setName(session?.user.name ?? "");
  }, [session?.user.name]);
  useEffect(() => {
    setImage(session?.user.image ?? "");
  }, [session?.user.image]);

  // Everything saves as you go — no Save button. Only the changed field is
  // sent; Better Auth's update-user takes a partial.
  // The last name sent, so the blur save and the pause save never both go out.
  const lastSentName = useRef<string | null>(null);
  const persist = async (patch: { name?: string; image?: string | null }) => {
    if (patch.name !== undefined) {
      if (patch.name === lastSentName.current) return;
      lastSentName.current = patch.name;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await useStore.getState().updateProfile(patch);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // A failed name save may be retried with the same text.
      if (patch.name !== undefined) lastSentName.current = null;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // The name saves a moment after typing stops (or on blur, below).
  const savedName = session?.user.name ?? "";
  const nameDraft = name.trim();
  useEffect(() => {
    if (nameDraft === savedName) return;
    if (!nameDraft) {
      setError("이름은 비워 둘 수 없어요.");
      return;
    }
    const timer = window.setTimeout(() => void persist({ name: nameDraft }), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameDraft, savedName]);

  // A picture pick or upload saves at once.
  const changeImage = (next: string) => {
    setImage(next);
    void persist({ image: next.trim() || null });
  };

  if (!session) return null;
  const trimmedName = name.trim();
  const trimmedImage = image.trim();

  // Re-sending the confirmation email: its own tiny state so a failure (this
  // server has no email; the provider refused) is said next to the button.
  const [resendBusy, setResendBusy] = useState(false);
  const [resendState, setResendState] = useState<string | null>(null);
  const resendConfirmation = async () => {
    setResendBusy(true);
    setResendState(null);
    try {
      await useStore.getState().resendVerificationEmail();
      setResendState("sent");
    } catch (e) {
      setResendState(e instanceof Error ? e.message : String(e));
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div className="account-profile">
      {/* Settings rows: title + one-line hint on the left, the control on the
          right, so a section title, a label and a value never read alike. */}
      <div className="profile-rows">
        <div className="profile-row">
          <div className="profile-row-label">
            <span className="profile-row-title">사진</span>
            <span className="profile-row-hint">
              사진이나 캐릭터를 고르세요. 팀원에게 사이드바와 내 커서에 표시돼요.
            </span>
          </div>
          <div className="profile-row-control profile-photo-control">
            <Avatar
              label={trimmedName || session.user.email}
              image={trimmedImage || null}
              userId={session.user.id}
            />
            <ProfilePictureActions image={trimmedImage} onChange={changeImage} onError={setError} />
          </div>
        </div>

        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">캐릭터</span>
            <span className="profile-row-hint">사진 대신 캐릭터를 고를 수 있어요.</span>
          </div>
          <div className="profile-row-control">
            <ProfileCharacterGrid
              label={trimmedName || session.user.email}
              userId={session.user.id}
              image={trimmedImage}
              onChange={changeImage}
            />
          </div>
        </div>

        <div className="profile-row">
          <label className="profile-row-label" htmlFor="profile-display-name">
            <span className="profile-row-title">표시 이름</span>
            <span className="profile-row-hint">노트와 커서 옆에 표시돼요.</span>
          </label>
          <div className="profile-row-control">
            <input
              id="profile-display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => {
                nameFocused.current = true;
              }}
              onBlur={() => {
                nameFocused.current = false;
                // Leaving the field saves now rather than after the pause.
                if (nameDraft && nameDraft !== savedName) void persist({ name: nameDraft });
              }}
              placeholder="이름"
              autoComplete="name"
            />
          </div>
        </div>

        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">이메일</span>
            <span className="profile-row-hint">로그인과 초대에 사용해요.</span>
          </div>
          <div className="profile-row-control">
            <div className="profile-email">
              <span className="profile-email-value">{session.user.email}</span>
              {/* Verification state, live: the confirmation link bounces back
                  into the app (`mav://verified`), which re-reads the session,
                  so this flips without a reload. `emailVerified` is absent on
                  very old servers: say nothing rather than "not confirmed". */}
              {session.user.emailVerified === true && (
                <span className="profile-pill ok">확인됨</span>
              )}
              {session.user.emailVerified === false && (
                <span className="profile-pill warn">확인 안 됨</span>
              )}
            </div>
            {session.user.emailVerified === false && (
              <span className="profile-row-hint profile-email-hint">
                받은편지함에서 확인 메일을 확인하세요.{" "}
                <button
                  type="button"
                  className="linkish"
                  disabled={resendBusy}
                  onClick={() => void resendConfirmation()}
                >
                  {resendBusy ? "보내는 중…" : resendState === "sent" ? "보냄 ✓" : "다시 보내기"}
                </button>
                {resendState && resendState !== "sent" && (
                  <span className="update-status error"> {resendState}</span>
                )}
              </span>
            )}
          </div>
        </div>
        <SecurityCodeField />
      </div>

      {error && <div className="auth-error">{error}</div>}

      <span className="update-status profile-save-status" role="status" aria-live="polite">
        {saving ? "저장 중…" : saved ? "저장됨" : ""}
      </span>
    </div>
  );
}

/**
 * Profile → picture, in the same style as a vault's icon picker: your default
 * character (seeded by your name), one of the preset characters, or an
 * uploaded photo. A pick saves straight away.
 */
function ProfilePictureActions({
  image,
  onChange,
  onError,
}: {
  /** The form's image value: "" = default character. */
  image: string;
  onChange: (image: string) => void;
  onError: (message: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    try {
      onError(null);
      onChange(await imageFileToSquareDataUrl(file, PROFILE_IMAGE_PX, PROFILE_IMAGE_MAX_CHARS));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="profile-hero-actions">
      {image && (
        <button type="button" className="link-btn" onClick={() => onChange("")}>
          기본값 사용
        </button>
      )}
      <button type="button" className="secondary sm" onClick={() => fileRef.current?.click()}>
        이미지 올리기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

function ProfileCharacterGrid({
  label,
  userId,
  image,
  onChange,
}: {
  label: string;
  userId: string;
  image: string;
  onChange: (image: string) => void;
}) {
  return (
    <div className="profile-characters">
      <div className="profile-character-grid" role="radiogroup" aria-label="캐릭터">
        <button
          type="button"
          className={`profile-character-option${image === "" ? " active" : ""}`}
          role="radio"
          aria-checked={image === ""}
          title="내 기본 캐릭터"
          onClick={() => onChange("")}
        >
          <Avatar label={label} userId={userId} image={null} />
        </button>
        {PROFILE_CHARACTER_SEEDS.map((seed) => {
          const value = CHARACTER_PREFIX + seed;
          return (
            <button
              key={seed}
              type="button"
              className={`profile-character-option${image === value ? " active" : ""}`}
              role="radio"
              aria-checked={image === value}
              onClick={() => onChange(value)}
            >
              <Avatar label={label} image={value} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusTab() {
  const activityStatus = useStore((s) => s.activityStatus);
  // A status moment ("Coffee break") is none of the four options below, which
  // left every radio unticked with no word about what was actually set.
  const moment = STATUS_MOMENTS.find((m) => m.id === activityStatus);

  return (
    <div className="status-tab">
      <p className="muted">
        같은 노트에서 작업하는 팀원에게 내 커서 옆에 상태가 표시돼요.
      </p>
      {moment && (
        <p className="field-hint">
          현재: {moment.label} (계정 메뉴에서 설정). 아래에서 상태를 고르면 바뀌어요.
        </p>
      )}
      <div className="status-options">
        {ACTIVITY_STATUSES.map((s) => {
          const active = s.id === activityStatus;
          return (
            <button
              key={s.id}
              type="button"
              className={`menu-item${active ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={active}
              onClick={() => useStore.getState().setActivityStatus(s.id as ActivityStatus)}
            >
              <span className={`status-dot ${s.id}`} aria-hidden="true" />
              <span className="menu-item-label">
                {s.label}
                <span className="field-hint">{s.hint}</span>
              </span>
              {active && (
                <svg
                  className="menu-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const editorFont = useStore((s) => s.editorFont);
  const homeSectionHidden = useStore((s) => s.homeSectionHidden);
  const overrides = useStore((s) => s.appearanceOverrides);
  const vaultAppearance = useStore((s) => s.vaultAppearance);
  const orgId = useStore((s) =>
    s.vault && s.syncEnabled ? (s.session?.activeOrganizationId ?? null) : null,
  );
  const values = useStore(
    useShallow((s) => ({
      theme: s.themeMode,
      autoColors: s.automaticItemColors,
      contentWidth: s.editorMeasure,
      textSize: s.editorFontSize,
      lineNumbers: s.lineNumbers,
      properties: s.propertiesMode,
    })),
  );
  // A synced vault always has a value for every row (a key it never saved is
  // the app default), so treat it as present even before its row has loaded.
  const vault = orgId ? (vaultAppearance[orgId] ?? {}) : null;
  const set = <K extends AppearanceKey>(key: K, value: AppearanceSettings[K] | undefined) => {
    const st = useStore.getState();
    // The legacy setters also keep the old per-key storage current.
    if (key === "autoColors") st.setAutomaticItemColors(value as boolean);
    else if (key === "contentWidth") st.setEditorMeasure(value as EditorMeasure);
    else if (key === "textSize") st.setEditorFontSize(value as number);
    else if (key === "lineNumbers") st.setLineNumbers(value as boolean);
    else if (key === "properties") st.setPropertiesMode(value as PropertiesMode);
    else st.setAppearanceOverride(key, value);
  };
  return (
    <>
    <label className="menu-row toggle-row">
      <span className="menu-row-label">홈 섹션 표시
        <span className="field-hint">끄면 홈 설정이 해제되고 이 기기에서 시작할 때 홈이 열리지 않아요.</span>
      </span>
      <Switch checked={!homeSectionHidden} ariaLabel="홈 섹션 표시"
        onChange={(show) => useStore.getState().setHomeSectionHidden(!show)} />
    </label>
    <AppearanceRows
      mode="personal"
      values={values}
      onChange={set}
      trailing={(key) => {
        const source = appearanceSource(key, overrides, vault);
        if (source === "vault") return <span className="appearance-tag">볼트 기본값</span>;
        if (source === "personal" && vault) {
          return (
            <button
              type="button"
              className="link-btn appearance-clear"
              onClick={(e) => {
                e.preventDefault();
                useStore.getState().setAppearanceOverride(key, undefined);
              }}
            >
              볼트 기본값으로 되돌리기
            </button>
          );
        }
        return null;
      }}
    />
    <div className="menu-row">
      <span className="menu-row-label">
        노트 글꼴
        <span className="field-hint">이 기기에서 노트를 쓸 때 사용하는 글꼴이에요.</span>
      </span>
      <MenuSelect<EditorFont>
        value={editorFont}
        options={EDITOR_FONTS.map((f) => ({ value: f.id, label: f.label, hint: f.hint }))}
        onSelect={(f) => useStore.getState().setEditorFont(f)}
        ariaLabel="노트 글꼴"
        triggerClassName="role-field-trigger"
      />
    </div>
    </>
  );
}

function NotificationsTab() {
  const mentionSound = useStore((s) => s.mentionSound);
  return (
    <label className="menu-row toggle-row">
      <span className="menu-row-label">
        멘션 알림음
        <span className="field-hint">팀원이 나를 멘션하면 소리를 재생해요.</span>
      </span>
      <Switch
        checked={mentionSound}
        ariaLabel="멘션 알림음"
        onChange={(next) => useStore.getState().setMentionSound(next)}
      />
    </label>
  );
}

export function ConnectionTab() {
  const serverUrl = useStore((s) => s.serverUrl);
  const addressInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(serverUrl);
  const [recent, setRecent] = useState(readRecentServers);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(serverUrl);
    // Read only: opening the tab must not reorder the history. Recents are
    // recorded by a switch that actually landed (`switchServer`).
    setRecent(readRecentServers());
  }, [serverUrl]);

  /**
   * Check the address answers BEFORE adopting it. Changing the server is a
   * de-facto sign-out (the session lives under a per-server keychain key), so a
   * typo used to swap a working session for a signed-out app and no message at
   * all — `save` had a `finally` and no `catch`.
   */
  // Compare the normalized address, so "https://x.example/" still selects
  // its recent entry instead of the placeholder.
  const draftUrl = normalizeServerUrl(draft);
  const selectedRecent = draftUrl && recent.includes(draftUrl) ? draftUrl : "";
  const activeUrl = normalizeServerUrl(serverUrl);

  const save = async () => {
    const url = normalizeServerUrl(draft);
    if (!url) {
      setError("서버 주소가 올바르지 않아요. https://notes.example.com 형식으로 입력해 보세요.");
      return;
    }
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await authManager.api.health(url);
      // Another flow (an invite link's Connect, a sign-in) can take the switch
      // over; then nothing was saved here, so say nothing. The managed/custom
      // choice is written only once the switch landed.
      const switched = await switchServer(url, {
        switchTo: (next) => useStore.getState().setServerUrl(next),
        writeChoice: writeServerChoice,
        defaultUrl: DEFAULT_SERVER_URL,
        previousUrl: serverUrl,
      });
      if (!switched) return;
      setRecent(readRecentServers());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(serverFailureMessage(e, url));
    } finally {
      setBusy(false);
    }
  };

  // Redesign: two clear choices. 마브 Cloud is the managed server; anything
  // else is "your own", which is the only case that needs an address typed.
  // 마브 has no managed server (PRODUCTION_SERVER_URL is empty): no Cloud
  // card, and the address box is always the one choice.
  const hasCloud = Boolean(PRODUCTION_SERVER_URL);
  const cloudUrl = normalizeServerUrl(DEFAULT_SERVER_URL);
  const isCloud = hasCloud && draftUrl === cloudUrl;
  const pick = (url: string) => {
    setDraft(url);
    setSaved(false);
    setError(null);
  };

  return (
    <div className="connection-tab conn-b">
      <p className="field-hint">
        {hasCloud ? "노트를 동기화할 위치를 선택하세요. 서버마다 따로 로그인해요." : "노트를 동기화할 팀 서버예요. 서버마다 따로 로그인해요."}
      </p>
      <div className="conn-options" role="radiogroup" aria-label="서버">
        {hasCloud && (
        <button
          type="button"
          role="radio"
          aria-checked={isCloud}
          className={`conn-option${isCloud ? " is-selected" : ""}`}
          disabled={busy}
          onClick={() => pick(DEFAULT_SERVER_URL)}
        >
          <span className="conn-radio" aria-hidden="true" />
          <span className="conn-tile is-cloud" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 18a5 5 0 0 0-1-9.9 7 7 0 0 0-13 3.4A4 4 0 0 0 4 18h13z" /></svg>
          </span>
          <b>마이 세컨드 브레인 Cloud</b>
          <span className="conn-option-hint">마이 세컨드 브레인이 관리해요. 따로 설정할 게 없어요.</span>
        </button>
        )}
        <div
          role="radio"
          aria-checked={!isCloud}
          tabIndex={0}
          className={`conn-option${!isCloud ? " is-selected" : ""}`}
          onClick={() => {
            if (isCloud) pick(selectedRecent && selectedRecent !== cloudUrl ? selectedRecent : "");
            window.setTimeout(() => addressInput.current?.focus(), 0);
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
              e.preventDefault();
              if (isCloud) pick("");
              addressInput.current?.focus();
            }
          }}
        >
          <span className="conn-radio" aria-hidden="true" />
          <span className="conn-tile is-own" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
          </span>
          <b>팀 서버</b>
          <span className="conn-option-hint">팀이 띄운 서버 주소를 넣어요. 노트는 그 서버와 각 기기에 저장돼요.</span>
        </div>
      </div>
      {/* Below the two cards, not inside one: growing a card made both
          cards resize and jump whenever the choice flipped. */}
      {!isCloud && (
        <input
          ref={addressInput}
          className="conn-address"
          value={draft}
          disabled={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="https://notes.example.com"
          aria-label="서버 주소"
          spellCheck={false}
          autoCapitalize="off"
        />
      )}
      {recent.length > 0 && (
        <div className="conn-recent">
          <span className="conn-recent-label">최근 연결</span>
          <div className="conn-chips" role="group" aria-label="최근 연결">
            {recent.map((url) => (
              <button
                key={url}
                type="button"
                className={`conn-chip${url === draftUrl ? " is-picked" : ""}${url === activeUrl ? " is-active" : ""}`}
                disabled={busy}
                aria-pressed={url === draftUrl}
                title={url === activeUrl ? `${url} (사용 중)` : url}
                onClick={() => pick(url)}
              >
                {serverHost(url)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="conn-foot">
        <span className="conn-status" role="status">
          {saved ? "다시 연결했어요." : `${serverHost(serverUrl)}에 연결됨`}
        </span>
        <button
          type="button"
          className="primary sm"
          disabled={busy || !draft.trim() || normalizeServerUrl(draft) === serverUrl}
          onClick={() => void save()}
        >
          {busy && <span className="btn-spinner" aria-hidden="true" />}
          <span>연결</span>
        </button>
      </div>
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}

function AboutTab({ onClose }: { onClose: () => void }) {
  const update = useUpdateState();
  const serverUrl = useStore((s) => s.serverUrl);
  const email = useStore((s) => s.session?.user.email ?? "");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  // Updates install themselves, so this button only kicks off the same silent
  // path the launch check and the poll use — there is no Install step to offer.
  const busy =
    update.phase === "checking" ||
    update.phase === "available" ||
    update.phase === "downloading" ||
    update.phase === "installing" ||
    update.phase === "ready";

  let statusText: string | null = null;
  switch (update.phase) {
    case "checking":
      statusText = "업데이트를 확인하는 중…";
      break;
    case "uptodate":
      statusText = "최신 버전을 사용 중이에요.";
      break;
    case "available":
      statusText = `${update.version} 버전을 찾았어요. 다운로드를 시작하는 중…`;
      break;
    case "downloading":
      statusText =
        update.total > 0
          ? `${update.version} 다운로드 중: ${Math.round((update.downloaded / update.total) * 100)}%`
          : `${update.version} 다운로드 중…`;
      break;
    case "installing":
      statusText = `${update.version} 설치 중…`;
      break;
    case "ready":
      statusText = `${update.version} 버전을 설치했어요. 곧 다시 시작해요.`;
      break;
    case "pending":
      // The server already runs a newer release than the feed can serve yet;
      // the check retries on its own. Quiet on purpose — nothing is wrong.
      statusText = "업데이트가 곧 도착해요.";
      break;
    case "error":
      statusText = `업데이트를 확인하지 못했어요: ${update.message}`;
      break;
    case "failed":
      statusText = `${update.version} 버전을 설치하지 못했어요${update.message ? `: ${update.message}` : ""}`;
      break;
  }

  return (
    <div className="about-tab">
      {/* One card for every update state, so nothing jumps between steps. */}
      <UpdateCard
        view={updateView(update, version)}
        statusText={statusText}
        busy={busy}
        onCheck={() => void checkAndAutoInstall()}
        onRestart={() => void relaunchForUpdate()}
      />

      <div className="profile-rows about-rows">
        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">설치된 에이전트</span>
            <span className="profile-row-hint">대시보드를 업데이트할 때 사용해요. 마이 세컨드 브레인을 시작할 때 찾아요.</span>
          </div>
          <div className="profile-row-control">
            <InstalledAgentsList />
          </div>
        </div>
        <div className="profile-row">
          <div className="profile-row-label">
            <span className="profile-row-title">서버</span>
            <span className="profile-row-hint">노트를 동기화하는 곳이에요.</span>
          </div>
          <div className="profile-row-control about-inline">
            <span className="about-value">
              <span className="about-live-dot" aria-hidden="true" />
              {serverHost(serverUrl)}
            </span>
          </div>
        </div>
        <div className="profile-row">
          <div className="profile-row-label">
            <span className="profile-row-title">계정</span>
            <span className="profile-row-hint">로그아웃해도 노트는 이 컴퓨터에 남아 있어요.</span>
          </div>
          <div className="profile-row-control about-inline">
            <span className="about-value">{email}</span>
            <button
              type="button"
              className="about-signout"
              onClick={() => {
                onClose();
                void useStore.getState().signOut();
              }}
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** About's update card: mark, version and status, the one action, progress. */
function UpdateCard({
  view,
  statusText,
  busy,
  onCheck,
  onRestart,
}: {
  view: ReturnType<typeof updateView>;
  statusText: string | null;
  busy: boolean;
  onCheck: () => void;
  onRestart: () => void;
}) {
  return (
    <div className={`update-card is-${view.tone}`}>
      <div className="update-card-row">
        <img className="update-card-mark is-icon" src={appIcon} alt="" aria-hidden="true" />
        <div className="update-card-text">
          <span className="update-card-title">{view.title}</span>
          <span className="update-card-sub" role="status" aria-live="polite">
            {view.tone === "ok" || view.tone === "ready" ? <span className="update-card-dot" aria-hidden="true" /> : null}
            {view.sub || statusText}
          </span>
        </div>
        {view.tone === "busy" && view.percent === null && <span className="btn-spinner update-card-spin" aria-hidden="true" />}
        {view.action === "restart" ? (
          <button type="button" className="update-card-btn is-ink" onClick={onRestart}>
            지금 다시 시작
          </button>
        ) : view.action ? (
          <button type="button" className="update-card-btn" disabled={busy} onClick={onCheck}>
            {view.action === "retry" ? "다시 시도" : "업데이트 확인"}
          </button>
        ) : null}
      </div>
      {view.percent !== null && (
        <span className="update-card-bar" aria-hidden="true">
          <b style={{ width: `${view.percent}%` }} />
        </span>
      )}
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="menu-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export { AccountSettings as default };

