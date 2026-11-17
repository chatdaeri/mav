// "Add a marketplace": the app's form dialog (InvitePeopleDialog's shell:
// header, body, right-aligned footer), not the confirm dialog. A live check
// peeks at the repo as you type and shows what it found in a preview card,
// so Add only lights up for something real.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseRepoInput, peekMarketplace, formatLabel, type GitHubReader, type MarketplacePeek } from "../../lib/skills/marketplace";
import { Spinner } from "../Spinner";
import { BusyButton, GitHubGlyph } from "./parts";

const CHECK_DELAY_MS = 400;

type Check =
  | { status: "idle" }
  | { status: "invalid" }
  | { status: "checking"; repo: string }
  | { status: "ok"; peek: MarketplacePeek; repo: string; ref: string | null }
  | { status: "error"; message: string };

function BranchGlyph() {
  return (
    <svg className="skills-gh" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M4.5 2.5v11M4.5 10.5c0-3 7-2 7-5.5M11.5 5a1.5 1.5 0 1 0 0-.01M4.5 13.5a1.5 1.5 0 1 0 0-.01M4.5 2.5a1.5 1.5 0 1 0 0-.01"
      />
    </svg>
  );
}

export function AddMarketplaceDialog({
  reader,
  onAdd,
  onClose,
}: {
  /** Reads GitHub with the admin's token when this computer has one. */
  reader: () => Promise<GitHubReader>;
  /** Saves the source and opens it; resolves to an error message, or null when done. */
  onAdd: (repo: string, ref: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [showRef, setShowRef] = useState(false);
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const refInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (showRef) refInput.current?.focus();
  }, [showRef]);

  // Live check: format first, then a cheap peek, ~400ms after typing stops.
  useEffect(() => {
    setError(null);
    if (!repo.trim()) {
      setCheck({ status: "idle" });
      return;
    }
    const parsed = parseRepoInput(repo, showRef ? ref : null);
    if (!parsed) {
      setCheck({ status: "invalid" });
      return;
    }
    let cancelled = false;
    setCheck({ status: "checking", repo: parsed.repo });
    const t = setTimeout(() => {
      void reader()
        .then((r) => peekMarketplace(r, parsed))
        .then(
          (peek) => {
            if (!cancelled) setCheck({ status: "ok", peek, repo: parsed.repo, ref: parsed.ref });
          },
          (e) => {
            if (!cancelled) setCheck({ status: "error", message: e instanceof Error ? e.message : String(e) });
          },
        );
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [repo, ref, showRef, reader]);

  const ready = check.status === "ok";
  const add = async () => {
    if (check.status !== "ok") return;
    const failure = await onAdd(check.repo, check.ref);
    if (failure) setError(failure);
    else onClose();
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && ready) addRef.current?.click();
  };

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        className="modal skills-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="마켓플레이스 추가"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-form-head">
          <h2 className="confirm-title">마켓플레이스 추가</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <p className="skills-form-intro">
          GitHub 저장소를 붙여 넣으세요. Claude·Codex 플러그인 마켓플레이스와 스킬이 들어 있는 모든 저장소를 쓸 수 있어요.
        </p>

        <label className="skills-prefix-input">
          <GitHubGlyph />
          <input
            autoFocus
            value={repo}
            placeholder="owner/repo 또는 github.com 링크"
            aria-label="저장소"
            spellCheck={false}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={enter}
          />
        </label>

        {showRef ? (
          <label className="skills-prefix-input skills-ref-input">
            <BranchGlyph />
            <input
              ref={refInput}
              value={ref}
              placeholder="브랜치 또는 태그, 예: main"
              aria-label="브랜치 또는 태그"
              spellCheck={false}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !ref) {
                  e.stopPropagation();
                  setShowRef(false);
                } else enter(e);
              }}
            />
            <button
              type="button"
              className="skills-ref-clear"
              aria-label="기본 브랜치 사용"
              title="기본 브랜치 사용"
              onClick={() => {
                setRef("");
                setShowRef(false);
              }}
            >
              ✕
            </button>
          </label>
        ) : (
          <button type="button" className="skills-ref-toggle" onClick={() => setShowRef(true)}>
            <BranchGlyph />
            브랜치 또는 태그 선택
          </button>
        )}

        <div className="skills-preview" aria-live="polite">
          {check.status === "checking" ? (
            <div className="skills-preview-card">
              <Spinner size="xs" />
              <span className="skills-preview-text">
                <span className="skills-preview-title">{check.repo}</span>
                <span className="skills-preview-sub">스킬을 찾는 중…</span>
              </span>
            </div>
          ) : check.status === "ok" ? (
            <div className="skills-preview-card is-ok">
              <span className="skills-preview-mark" aria-hidden="true">✓</span>
              <span className="skills-preview-text">
                <span className="skills-preview-title">
                  {check.repo}
                  {check.ref ? ` · ${check.ref}` : ""}
                </span>
                <span className="skills-preview-sub">
                  {check.peek.skills > 0
                    ? `${formatLabel(check.peek.format)} · 스킬 ${check.peek.skills}개`
                    : "저장소를 찾았지만 아직 스킬이 보이지 않아요. 그래도 추가할 수 있어요."}
                </span>
              </span>
            </div>
          ) : check.status === "error" ? (
            <div className="skills-preview-card is-bad">
              <span className="skills-preview-mark" aria-hidden="true">!</span>
              <span className="skills-preview-text">
                <span className="skills-preview-sub">{check.message}</span>
              </span>
            </div>
          ) : check.status === "invalid" ? (
            <div className="skills-preview-hint">owner/repo 형식으로 입력하거나 저장소의 GitHub 링크를 붙여 넣으세요.</div>
          ) : (
            <div className="skills-preview-hint">비공개 저장소인가요? 먼저 마켓플레이스 페이지에서 GitHub 토큰을 저장하세요.</div>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}

        <div className="confirm-actions skills-form-actions">
          <button type="button" className="ghost-pill" onClick={onClose}>취소</button>
          <BusyButton ref={addRef} className="primary" busyLabel="추가하는 중…" disabled={!ready} onClick={add}>
            마켓플레이스 추가
          </BusyButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
