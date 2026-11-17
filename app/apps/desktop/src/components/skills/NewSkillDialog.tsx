// "New skill": the app's form dialog (AddMarketplaceDialog's shell), not the
// confirm dialog. The name is the slash command teammates type, checked as you
// type (format, taken, claude.ai's reserved words); the optional "when to use
// it" becomes SKILL.md's description, so the skill starts out usable.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isValidSkillName, skillNameNeedsWarning } from "../../lib/skills/validate";
import { BusyButton } from "./parts";

/** SKILL.md's `description` limit (docs/SKILLS.md §1.1). */
const DESCRIPTION_MAX = 1024;

/** Typing "Deploy notes" gives "deploy-notes": lowercase, spaces and underscores to hyphens. */
function tidyName(raw: string): string {
  return raw.toLowerCase().replace(/[\s_]+/g, "-");
}

export function NewSkillDialog({
  takenNames,
  onCreate,
  onClose,
}: {
  /** The vault's skill names, lowercased. */
  takenNames: ReadonlySet<string>;
  /** Creates it and opens its page; resolves to an error message, or null when done. */
  onCreate: (name: string, description: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement | null>(null);

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

  const trimmed = name.replace(/^-+|-+$/g, "");
  const taken = trimmed !== "" && takenNames.has(trimmed);
  const valid = isValidSkillName(trimmed) && !taken;
  const status: { tone: "ok" | "bad" | "hint"; text: string } =
    trimmed === ""
      ? { tone: "hint", text: "소문자, 숫자, 하이픈만 쓸 수 있어요. 나중에 바꿀 수 없어요." }
      : taken
        ? { tone: "bad", text: `팀에 이미 /${trimmed}이(가) 있어요.` }
        : !isValidSkillName(trimmed)
          ? { tone: "bad", text: "소문자, 숫자, 하이픈 한 개씩만 쓰고 64자까지 입력할 수 있어요." }
          : { tone: "ok", text: `팀원은 /${trimmed}(으)로 사용해요` };

  const create = async () => {
    if (!valid) return;
    setError(null);
    const failure = await onCreate(trimmed, description.trim());
    if (failure) setError(failure);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        className="modal skills-form-dialog skills-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="새 스킬"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-form-head">
          <h2 className="confirm-title">새 스킬</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <p className="skills-form-intro">
          이름을 짓고 팀의 AI가 언제 사용해야 하는지 적으세요. 다음 단계에서 지침을 작성해요.
        </p>

        <label className="skills-field-label" htmlFor="new-skill-name">이름</label>
        <label className="skills-prefix-input">
          <span className="skills-slash" aria-hidden="true">/</span>
          <input
            id="new-skill-name"
            autoFocus
            value={name}
            placeholder="release-notes"
            spellCheck={false}
            autoComplete="off"
            maxLength={80}
            onChange={(e) => setName(tidyName(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) createRef.current?.click();
            }}
          />
        </label>
        <div className={`skills-name-status is-${status.tone}`} aria-live="polite">
          {status.tone === "ok" && <span aria-hidden="true">✓ </span>}
          {status.text}
        </div>
        {skillNameNeedsWarning(trimmed) && (
          <div className="skills-warning">claude.ai는 "claude"나 "anthropic"이 들어간 이름을 거부해요.</div>
        )}

        <label className="skills-field-label" htmlFor="new-skill-desc">
          AI가 언제 사용해야 하나요? <span className="skills-field-optional">선택</span>
        </label>
        <textarea
          id="new-skill-desc"
          className="skills-desc-input"
          value={description}
          rows={3}
          maxLength={DESCRIPTION_MAX}
          placeholder="예: 앱의 릴리스 노트나 변경 내역을 작성할 때 사용"
          onChange={(e) => setDescription(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) createRef.current?.click();
          }}
        />
        <div className="skills-desc-count">
          {description.length > DESCRIPTION_MAX - 200 ? `${description.length} / ${DESCRIPTION_MAX}` : ""}
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="confirm-actions skills-form-actions">
          <button type="button" className="ghost-pill" onClick={onClose}>취소</button>
          <BusyButton ref={createRef} className="primary" busyLabel="만드는 중…" disabled={!valid} onClick={create}>
            스킬 만들기
          </BusyButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
