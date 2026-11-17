import { useEffect, useRef, useState } from "react";
import { syncManager } from "../lib/sync/docSession";
import { createPortal } from "react-dom";
import type { McpToolInfo, McpTokenRow } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import * as ipc from "../lib/ipc";
import { isManagedServer } from "../lib/serverFeatures";
import { toast } from "../lib/toast";
import { copySensitiveText, SENSITIVE_COPIED_MESSAGE } from "../lib/clipboard";
import { useStore } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { BusyButton } from "./skills/parts";
import { ToolLogo } from "./skills/ToolLogos";
import "./skills/skills.css";
import "./McpTab.css";

/**
 * MCP: expose this vault to AI clients over the Model Context Protocol.
 * The MCP endpoint is part of the same server; a client authenticates with a
 * token minted here and then gets the SAME CRUD access to notes/folders that
 * the signed-in user has (owners/admins see everything; members see what's
 * shared with them). This is where you grab the URL + a token.
 *
 * Nothing on the page moves when you act: a new token is minted and shown in
 * a dialog, and every Copy flips to a tick in place.
 */
export function McpTab() {
  const session = useStore((s) => s.session);
  const serverUrl = useStore((s) => s.serverUrl);

  const mcpUrl = `${serverUrl.replace(/\/+$/, "")}/api/mcp`;
  const hasVault = !!session?.activeOrganizationId;

  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<McpTokenRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Bumps every 20s so "connected" dots + relative times stay live while open.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasVault) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = () =>
      authManager.api
        .listMcpConnections()
        .then(({ tokens, tools }) => {
          if (cancelled) return;
          setTokens(tokens);
          setTools(tools);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    // Poll so a connection that goes active/idle while the panel is open shows it.
    const poll = window.setInterval(() => void load(), 20_000);
    const tickle = window.setInterval(() => setTick((n) => n + 1), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tickle);
    };
  }, [hasVault]);

  const revoke = async (id: string) => {
    try {
      await authManager.api.revokeMcpToken(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
      setRevoking(null);
    } catch (e) {
      toast(`토큰을 폐기하지 못했어요: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  if (!hasVault) {
    return (
      <div className="muted perm-empty">
        MCP를 쓰려면 활성 볼트가 필요해요. 먼저 볼트를 만들거나 전환하세요.
      </div>
    );
  }

  return (
    <>
      <p className="mcp-lede">
        MCP를 지원하는 AI 클라이언트를 이 볼트에 연결하세요. 내가 가진 권한과
        똑같이 노트와 폴더를 읽고, 검색하고, 만들고, 편집하고, 삭제할 수 있어요.
        소유자와 관리자는 같은 대화에서 팀의 권한도 관리할 수 있어요.
      </p>

      <div className="profile-rows mcp-rows">
        {isManagedServer(serverUrl) && (
          <div className="profile-row">
            <div className="profile-row-label">
              <span className="profile-row-title mcp-row-title">
                <ToolLogo tool="claude" size={15} title="" />
                Claude
                <span className="mcp-official">공식 커넥터</span>
              </span>
              <span className="profile-row-hint">Claude 커넥터 디렉터리에서 한 번에 마이 세컨드 브레인을 추가하세요.</span>
            </div>
            <div className="profile-row-control mcp-row-end">
              <ClaudeDirectoryButton />
            </div>
          </div>
        )}

        <div className="profile-row">
          <div className="profile-row-label">
            <span className="profile-row-title">서버 주소</span>
            <span className="profile-row-hint">MCP 클라이언트에 붙여넣으세요.</span>
          </div>
          <div className="profile-row-control">
            <CopyField value={mcpUrl} label="서버 주소" />
          </div>
        </div>

        <div className="profile-row profile-row-top">
          <div className="profile-row-label">
            <span className="profile-row-title">액세스 토큰</span>
            <span className="profile-row-hint">
              토큰 하나는 AI 클라이언트 하나를 이 볼트에 내 권한으로 연결해요. 언제든 폐기할 수 있어요.
            </span>
            <button
              type="button"
              className="mcp-new-token"
              onClick={() => setCreating(true)}
            >
              새 토큰
            </button>
          </div>
          <div className="profile-row-control">
      {loading ? (
        <div className="mcp-empty">불러오는 중…</div>
      ) : tokens.length === 0 ? (
        <div className="mcp-empty">아직 토큰이 없어요. 토큰을 만들어 AI 클라이언트를 연결하세요.</div>
      ) : (
        <ul className="mcp-conn-list">
          {tokens.map((t) => {
            const live = isConnected(t.lastUsedAt);
            const open = expanded === t.id;
            return (
              <li key={t.id} className={`mcp-conn${open ? " open" : ""}`}>
                <div className="mcp-conn-head">
                  <span
                    className={`mcp-dot ${live ? "on" : "off"}`}
                    title={live ? "연결됨" : "연결 끊김"}
                    aria-hidden="true"
                  />
                  <div className="mcp-conn-main">
                    <div className="mcp-conn-title">
                      <span className="mcp-conn-name">{t.name}</span>
                      <span className={`mcp-status ${live ? "on" : "off"}`}>
                        {live ? "연결됨" : "연결 끊김"}
                      </span>
                    </div>
                    <div className="mcp-conn-sub">
                      {[
                        t.lastClient ? clientLabel(t.lastClient) : null,
                        t.tokenPrefix,
                        `호출 ${t.useCount}회`,
                        t.lastUsedAt
                          ? `마지막 사용 ${relTime(t.lastUsedAt)}`
                          : `${relTime(t.createdAt)} 생성, 사용 기록 없음`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="mcp-conn-actions">
                    <button
                      type="button"
                      className="link-btn"
                      aria-expanded={open}
                      onClick={() => setExpanded((e) => (e === t.id ? null : t.id))}
                    >
                      {open ? "도구 숨기기" : `도구 · ${tools.length}`}
                    </button>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => setRevoking(t)}
                    >
                      폐기
                    </button>
                  </div>
                </div>
                {open && (
                  <ul className="mcp-tool-list">
                    {tools.map((tool) => (
                      <li key={tool.name} title={tool.description}>
                        <span className={`mcp-tool-badge ${tool.access}`}>
                          {tool.access === "read"
                            ? "읽기"
                            : tool.access === "destructive"
                              ? "삭제"
                              : "쓰기"}
                        </span>
                        <code>{tool.name}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
          </div>
        </div>
      </div>

      {creating && (
        <NewMcpTokenDialog
          mcpUrl={mcpUrl}
          onCreated={(row) => setTokens((prev) => [row, ...prev])}
          onClose={() => setCreating(false)}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title={`“${revoking.name}” 토큰을 폐기할까요?`}
          confirmLabel="토큰 폐기"
          onConfirm={() => revoke(revoking.id)}
          onCancel={() => setRevoking(null)}
        >
          이 토큰을 쓰는 AI 클라이언트는 즉시 볼트에 접근할 수 없게 돼요.
          새 토큰은 언제든 만들 수 있어요.
        </ConfirmDialog>
      )}
    </>
  );
}

/** The directory listing points at the managed server, so self-hosters never see it. */
const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/baalda";

function ClaudeDirectoryButton() {
  return (
    <>
      <button
        type="button"
        className="secondary mcp-directory-btn"
        onClick={() =>
          void ipc.openExternal(CLAUDE_DIRECTORY_URL).catch((e) =>
            toast(`목록 페이지를 열지 못했어요: ${e instanceof Error ? e.message : String(e)}`, "error"),
          )
        }
      >
        목록 보기
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 10.5l5-5M6.5 5.5h4v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}

type Client = "claude" | "codex" | "other";
const CLIENTS: { id: Client; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "other", label: "다른 앱" },
];

/**
 * New token, in one dialog: name it, then copy it and a setup snippet. The
 * second step replaces the first in place, so nothing on the page behind it
 * moves; the token list updates underneath.
 */
function NewMcpTokenDialog({
  mcpUrl,
  onCreated,
  onClose,
}: {
  mcpUrl: string;
  onCreated: (row: McpTokenRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [client, setClient] = useState<Client>("claude");
  const createRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes while naming. Once the token is on screen it would be lost for
  // good, so only Done or ✕ close it then; Esc still stays ours either way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!created) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [created, onClose]);

  const create = async () => {
    setError(null);
    try {
      const minted = await authManager.api.createMcpToken(name.trim() || "MCP 토큰", syncManager.registry.vaultId);
      const { token, ...row } = minted;
      setCreated({ name: minted.name, token });
      onCreated(row);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Otherwise the button just returns to idle and the user clicks again,
      // minting duplicate tokens on a server that is actually failing (#85).
      toast(`MCP 토큰을 만들지 못했어요: ${message}`, "error");
    }
  };

  const token = created?.token ?? "";
  const claudeSnippet = `claude mcp add --transport http context ${mcpUrl} \\\n  --header "Authorization: Bearer ${token}"`;
  // Codex's own `mcp add` (like Claude's), which writes ~/.codex/config.toml.
  // It reads a bearer token only from an environment variable, so the second
  // line saves the token for new terminals (zsh, the macOS default shell).
  const codexSnippet = `codex mcp add context --url ${mcpUrl} --bearer-token-env-var CONTEXT_MCP_TOKEN\necho 'export CONTEXT_MCP_TOKEN="${token}"' >> ~/.zshrc`;

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (!created) onClose();
      }}
    >
      <div
        className="modal skills-form-dialog mcp-token-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={created ? "새 토큰" : "새 액세스 토큰"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-form-head">
          <h2 className="confirm-title">{created ? "새 토큰" : "새 액세스 토큰"}</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>

        {!created ? (
          <>
            <p className="skills-form-intro">
              나중에 구분할 수 있도록 토큰을 사용할 앱의 이름으로 지어 주세요.
            </p>
            <input
              autoFocus
              value={name}
              placeholder="예: Claude Desktop"
              aria-label="토큰 이름"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createRef.current?.click();
              }}
            />
            {error && <div className="auth-error">{error}</div>}
            <div className="confirm-actions skills-form-actions">
              <button type="button" className="ghost-pill" onClick={onClose}>
                취소
              </button>
              <BusyButton
                ref={createRef}
                className="primary"
                busyLabel="만드는 중…"
                onClick={create}
              >
                토큰 만들기
              </BusyButton>
            </div>
          </>
        ) : (
          <>
            <p className="skills-form-intro">
              지금 토큰을 복사하세요. 다시는 표시되지 않아요.
            </p>
            <CopyField value={created.token} label="토큰" wrap />

            <div className="mcp-setup-head">
              <span className="mcp-setup-title">설정할 앱</span>
              <div className="member-access-view mcp-client-tabs" role="tablist">
                {CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={client === c.id}
                    className={`member-access-view-btn mcp-client-tab${client === c.id ? " is-active" : ""}`}
                    onClick={() => setClient(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mcp-setup-body" role="tabpanel">
              {client === "claude" ? (
                <>
                  <CopyBlock value={claudeSnippet} label="Claude Code 명령" />
                  <div className="mcp-setup-hint">터미널에서 실행하세요.</div>
                </>
              ) : client === "codex" ? (
                <>
                  <CopyBlock value={codexSnippet} label="Codex 명령" />
                  <div className="mcp-setup-hint">그런 다음 새 터미널을 여세요.</div>
                </>
              ) : (
                <>
                  <div className="mcp-setup-label">서버 주소</div>
                  <CopyField value={mcpUrl} label="서버 주소" />
                  <div className="mcp-setup-label">헤더</div>
                  <CopyField value={`Authorization: Bearer ${created.token}`} label="헤더" wrap />
                </>
              )}
            </div>

            <div className="confirm-actions skills-form-actions">
              <button type="button" className="primary" onClick={onClose}>
                완료
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Copies on click; the glyph flips to a tick for 1.5 s in the same 28px box. */
function CopyButton({ value, label, sensitive = false }: { value: string; label: string; sensitive?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      if (sensitive) {
        // A secret: native write, then wiped after 60 s if still on the clipboard.
        if (!(await copySensitiveText(value))) return;
        toast(SENSITIVE_COPIED_MESSAGE);
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      className={`icon-btn mcp-copy-btn${copied ? " is-copied" : ""}`}
      aria-label={copied ? "복사됨" : `${label} 복사`}
      title={copied ? "복사됨" : `${label} 복사`}
      onClick={() => void copy()}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 3.5v-.4A1.6 1.6 0 0 0 8.9 1.5H4.1A1.6 1.6 0 0 0 2.5 3.1v4.8a1.6 1.6 0 0 0 1.6 1.6h.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
}

/** A monospace value with its copy button inside the field; one line unless `wrap`.
 *  `sensitive`: a secret, cleared from the clipboard 60 s after copying. */
export function CopyField({
  value,
  label,
  wrap = false,
  sensitive = false,
}: {
  value: string;
  label: string;
  wrap?: boolean;
  sensitive?: boolean;
}) {
  return (
    <div className="mcp-field">
      <code className={`mcp-field-value${wrap ? " is-wrapped" : ""}`} title={value}>
        {value}
      </code>
      <CopyButton value={value} label={label} sensitive={sensitive} />
    </div>
  );
}

/**
 * A multi-line command block: a small header (label + copy) over the commands,
 * each starting with a `$` prompt; indented lines are continuations of the one
 * above and get no prompt. The copied text is exactly `value`.
 */
function CopyBlock({ value, label }: { value: string; label: string }) {
  const lines = value.split("\n");
  return (
    <div className="mcp-field mcp-block">
      <div className="mcp-block-head">
        <span className="mcp-block-label">터미널</span>
        <CopyButton value={value} label={label} />
      </div>
      <code className="mcp-block-value">
        {lines.map((line, i) => (
          <span key={i} className={`mcp-block-line${/^\s/.test(line) ? " is-cont" : ""}`}>
            {line.trimStart()}
          </span>
        ))}
      </code>
    </div>
  );
}

/** A connection is "active" when it made a request in the last few minutes
 *  (MCP here is stateless HTTP — there's no socket to watch, so recency is it). */
const CONNECTED_WINDOW_MS = 3 * 60 * 1000;
function isConnected(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) return false;
  return Date.now() - new Date(lastUsedAt).getTime() < CONNECTED_WINDOW_MS;
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", else a date. */
export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "방금";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString();
}

/** Best-effort human name for a client from its User-Agent. */
function clientLabel(ua: string | null): string {
  if (!ua) return "알 수 없는 클라이언트";
  const s = ua.toLowerCase();
  if (s.includes("claude-code") || s.includes("claude code")) return "Claude Code";
  if (s.includes("claude")) return "Claude";
  if (s.includes("cursor")) return "Cursor";
  if (s.includes("node")) return "Node 클라이언트";
  // Fall back to the leading token of the UA (e.g. "MyApp/1.2" → "MyApp").
  return ua.split(/[\s/]/)[0].slice(0, 40) || "알 수 없는 클라이언트";
}
