import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, type BugReportDetails } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import { CLIENT_VERSION } from "../lib/clientVersion";
import { platformClass } from "../lib/platform";
import { containsVaultKey, VAULT_KEY_LEAK_MESSAGE } from "../lib/vaultKeys/leakGuard";
import { useStore } from "../store";
import { AsyncButton } from "./AsyncButton";

/** Mirrors the server's caps (src/http/routes/bug-reports.ts). */
const MAX_CHARS = 5000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** Mirrors the server's ATTACHMENT_TYPES keys — it re-checks every file. */
const ALLOWED_EXTS = [
  "png", "jpg", "jpeg", "gif", "webp", "heic", "pdf", "txt", "log", "md", "csv", "json", "zip", "mp4", "mov", "webm",
];
/** Attachments read as text for the vault-key check before sending. */
const TEXT_ATTACHMENT_EXTS = new Set(["txt", "log", "md", "csv", "json"]);
const ACCEPT =ALLOWED_EXTS.map((e) => `.${e}`).join(",");

interface Picked {
  id: number;
  file: File;
  /** Object URL for an image thumbnail, revoked when the file is removed. */
  preview: string | null;
}

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** File → base64 (no `data:` prefix), the shape the server expects. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽을 수 없어요"));
    reader.readAsDataURL(file);
  });
}

function isVideoLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * "Report a bug" — opened from the bug icon beside the account bar. Emails the
 * server operator's BUG_REPORT_EMAIL (the server owns the address; the app
 * only knows the feature is on via `/api/auth-methods`). Replies go to the
 * reporter. A Loom link and up to three files (picked, or a screenshot pasted
 * into the description) travel with it as real email attachments. App details
 * are opt-out and shown in full before sending: nothing travels that the
 * person did not see.
 */
export function BugReportDialog({ onClose }: { onClose: () => void }) {
  const email = useStore((s) => s.session?.user.email ?? "");
  const serverUrl = useStore((s) => s.serverUrl);
  const vaultName = useStore((s) => s.vault?.name ?? null);
  const syncStatus = useStore((s) => s.syncStatus);
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Thumbnails are object URLs; let them go with the dialog.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
    },
    [],
  );

  const details = useMemo<BugReportDetails>(
    () => ({
      appVersion: CLIENT_VERSION,
      platform: platformClass(),
      serverUrl,
      ...(vaultName ? { vault: vaultName } : {}),
      syncStatus,
    }),
    [serverUrl, vaultName, syncStatus],
  );
  const detailRows: Array<[string, string]> = [
    ["앱 버전", details.appVersion ?? ""],
    ["플랫폼", details.platform ?? ""],
    ["서버", details.serverUrl ?? ""],
    ...(details.vault ? ([["볼트", details.vault]] as Array<[string, string]>) : []),
    ["동기화 상태", details.syncStatus ?? ""],
  ];

  const addFiles = (incoming: File[]) => {
    setError(null);
    const next = [...files];
    for (const file of incoming) {
      if (!ALLOWED_EXTS.includes(extOf(file.name))) {
        setError(`${file.name}은(는) 첨부할 수 없어요. 이미지, PDF, 텍스트·로그 파일, JSON, ZIP 또는 짧은 동영상을 사용하세요.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        setError(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요.`);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name}이(가) ${formatBytes(MAX_FILE_BYTES)}를 넘어요. 긴 녹화는 Loom 링크를 붙여 넣으세요.`);
        continue;
      }
      const total = next.reduce((n, f) => n + f.file.size, 0) + file.size;
      if (total > MAX_TOTAL_BYTES) {
        setError(`첨부 파일은 합쳐서 ${formatBytes(MAX_TOTAL_BYTES)}까지 가능해요.`);
        continue;
      }
      next.push({
        id: nextId.current++,
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    setFiles(next);
  };

  const removeFile = (id: number) => {
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // A screenshot pasted into the description becomes an attachment (text
  // pastes as text, as usual).
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".");
    addFiles(
      images.map(
        (f, i) =>
          new File([f], `스크린샷 ${stamp}${images.length > 1 ? ` (${i + 1})` : ""}.${extOf(f.name) || "png"}`, {
            type: f.type,
          }),
      ),
    );
  };

  const trimmedLink = videoUrl.trim();
  const linkInvalid = trimmedLink !== "" && !isVideoLink(trimmedLink);

  const send = async () => {
    setError(null);
    // A vault key never leaves in a bug report, typed or attached.
    if (containsVaultKey(message)) {
      setError(VAULT_KEY_LEAK_MESSAGE);
      return;
    }
    for (const f of files) {
      if (!TEXT_ATTACHMENT_EXTS.has(extOf(f.file.name))) continue;
      if (containsVaultKey(await f.file.text().catch(() => ""))) {
        setError(VAULT_KEY_LEAK_MESSAGE);
        return;
      }
    }
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({ name: f.file.name, data: await toBase64(f.file) })),
      );
      await authManager.api.sendBugReport({
        message: message.trim(),
        ...(includeDetails ? { details } : {}),
        ...(trimmedLink ? { videoUrl: trimmedLink } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      setSent(true);
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : undefined;
      setError(
        e instanceof ApiError
          ? e.status === 429
            ? "최근 한 시간 동안 신고를 여러 번 보냈어요. 잠시 후 다시 시도해 주세요."
            : e.status === 404
              ? "이 서버는 더 이상 버그 신고를 받지 않아요."
              : e.status === 413 || code === "attachments_too_large"
                ? "첨부 파일이 너무 커요. 하나를 제거하거나 Loom 링크를 공유하세요."
                : code === "invalid_attachment"
                  ? "첨부할 수 없는 파일이 있어요. 다른 형식의 파일을 사용해 보세요."
                  : code === "invalid_video_link"
                    ? "동영상 링크가 올바르지 않아요. https://로 시작하는 전체 주소를 붙여 넣으세요."
                    : e.status === 502
                      ? "지금은 신고를 이메일로 보낼 수 없어요. 잠시 후 다시 시도해 주세요."
                      : e.message
          : "서버에 연결할 수 없어요. 연결 상태를 확인하고 다시 시도해 주세요.",
      );
    }
  };

  const trimmed = message.trim();
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal bug-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="버그 신고"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>버그 신고</span>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {sent ? (
          <div className="bug-report-sent">
            <span className="bug-report-sent-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <strong>신고를 보냈어요. 감사합니다.</strong>
            <p>
              {email ? (
                <>지원팀에 전달했어요. 답변은 {email}(으)로 보내드려요.</>
              ) : (
                "지원팀에 전달했어요. 마이 세컨드 브레인을 더 좋게 만드는 데 도움 주셔서 감사해요."
              )}
            </p>
            <div className="bug-report-actions">
              <button type="button" className="primary" onClick={onClose}>
                완료
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="bug-report-label" htmlFor="bug-report-message">
              어떤 문제가 있었나요?
            </label>
            <textarea
              id="bug-report-message"
              className="bug-report-message"
              autoFocus
              rows={5}
              maxLength={MAX_CHARS}
              placeholder="무엇을 하고 있었는지, 어떻게 되길 기대했는지, 실제로 어떻게 됐는지 적어 주세요. 스크린샷을 붙여 넣을 수도 있어요."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmed && !linkInvalid) {
                  e.preventDefault();
                  void send();
                }
              }}
            />

            <label className="bug-report-label" htmlFor="bug-report-video">
              Loom 또는 동영상 링크 <span className="bug-report-optional">선택</span>
            </label>
            <input
              id="bug-report-video"
              className={`bug-report-video${linkInvalid ? " is-invalid" : ""}`}
              type="url"
              inputMode="url"
              placeholder="https://www.loom.com/share/…"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              aria-invalid={linkInvalid}
            />
            {linkInvalid && <p className="bug-report-field-error">https://로 시작하는 전체 링크를 붙여 넣으세요</p>}

            <div className="bug-report-files">
              {files.map((f) => (
                <span key={f.id} className="bug-report-file" title={f.file.name}>
                  {f.preview ? (
                    <img src={f.preview} alt="" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                    </svg>
                  )}
                  <span className="bug-report-file-name">{f.file.name}</span>
                  <span className="bug-report-file-size">{formatBytes(f.file.size)}</span>
                  <button
                    type="button"
                    className="bug-report-file-remove"
                    aria-label={`${f.file.name} 제거`}
                    onClick={() => removeFile(f.id)}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {files.length < MAX_FILES && (
                <button type="button" className="ghost-pill sm bug-report-attach" onClick={() => fileInput.current?.click()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
                  </svg>
                  파일 첨부
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>

            <label className="bug-report-include">
              <input
                type="checkbox"
                checked={includeDetails}
                onChange={(e) => setIncludeDetails(e.target.checked)}
              />
              앱 정보 포함
            </label>
            {includeDetails && (
              <dl className="bug-report-details">
                {detailRows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd title={v}>{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}

            <div className="bug-report-actions bug-report-buttons">
              <button type="button" className="ghost-pill" onClick={onClose}>
                취소
              </button>
              <AsyncButton
                className="primary"
                spinnerTone="on-accent"
                disabled={!trimmed || linkInvalid}
                onClick={send}
              >
                신고 보내기
              </AsyncButton>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
