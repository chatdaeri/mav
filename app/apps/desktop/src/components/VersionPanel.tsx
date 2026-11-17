import { useEffect, useRef, useState } from "react";
import { AsyncButton } from "./AsyncButton";
import { ErrorBoundary } from "./ErrorBoundary";
import { Face } from "./Face";
import {
  agoFromIso,
  formatVersionSize,
  nextActiveIndex,
  revertToastText,
  versionAuthorLabel,
  versionCauseLabel,
} from "./versionFormat";
import type { NoteVersion } from "../lib/api";
import { bridgeManager } from "../lib/bridge";
import { sha256Hex } from "../lib/bridge/adapter";
import { toast } from "../lib/toast";
import { useStore } from "../store";

/**
 * How long the preview survives the pointer leaving a row. Same 140ms the
 * editor's presence roster uses: long enough to cross the gap to the next row
 * (or to the Revert button) without the underlying editor flashing back to the
 * live text and then away again.
 */
const PREVIEW_GRACE_MS = 140;

/**
 * Version history for the open note, the right panel's Versions tab (the
 * slide-in container lives in `RightPanel.tsx`) — a slide-in rather than
 * a modal, because the point of it is to be read *against* the editor: hovering
 * a row previews that version in place, and the live note is still there
 * underneath, still syncing, the moment the pointer leaves.
 *
 * Wrapped in an ErrorBoundary (as the graph view is): a panel that throws while
 * formatting one bad row must not take the editor down with it.
 */
export function VersionsTab() {
  const docId = useStore((s) => s.versionPanelDocId);
  if (!docId) {
    return (
      <p className="muted version-panel-empty">
        동기화된 노트를 열면 버전 기록을 볼 수 있어요.
      </p>
    );
  }
  return (
    <ErrorBoundary label="버전 기록" resetKeys={[docId]}>
      <VersionPanelBody key={docId} docId={docId} />
    </ErrorBoundary>
  );
}

function VersionPanelBody({ docId }: { docId: string }) {
  const versions = useStore((s) => s.noteVersions);
  const noteTitle = useStore((s) => s.openNote?.title ?? null);

  // Row 0 is the "Current" pseudo-entry; version i lives at index i + 1.
  const [active, setActive] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // sha256 of the live buffer, so a stored version that still matches what's on
  // screen can say so instead of inviting a revert that would change nothing.
  const [liveSha, setLiveSha] = useState<string | null>(null);

  const asideRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const graceRef = useRef<number | null>(null);

  const rows = versions ?? [];
  const rowCount = rows.length + 1;

  // Take focus so the arrow keys and Escape work without a second click.
  // preventScroll is load-bearing: at this moment the panel is still translated
  // off-screen right, and a plain focus() makes the browser scroll `.main`
  // sideways to reveal it — the whole page lurches, then snaps back.
  useEffect(() => {
    asideRef.current?.focus({ preventScroll: true });
  }, []);

  // Relative times stay honest while the panel sits open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Track the live text's hash. Re-hashing on every keystroke would be silly, so
  // it settles for a beat first; the badge is a hint, not a lock.
  useEffect(() => {
    const bridge = bridgeManager.currentBridge();
    if (!bridge) return;
    let cancelled = false;
    let timer: number | null = null;
    const recompute = () => {
      const text = bridge.text.toString();
      void sha256Hex(text).then((hash) => {
        if (!cancelled) setLiveSha(hash);
      });
    };
    const onChange = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(recompute, 250);
    };
    recompute();
    bridge.text.observe(onChange);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      bridge.text.unobserve(onChange);
    };
  }, [docId, versions]);

  // Keep the keyboard selection visible when it walks off the viewport. Skipped
  // on mount: scrollIntoView scrolls every scrollable ancestor, and doing that
  // while the panel is still sliding in drags `.main` sideways mid-animation.
  const didMountScroll = useRef(false);
  useEffect(() => {
    if (!didMountScroll.current) {
      didMountScroll.current = true;
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const cancelGrace = () => {
    if (graceRef.current != null) {
      window.clearTimeout(graceRef.current);
      graceRef.current = null;
    }
  };

  // Leaving the panel must always drop the preview, including when the panel is
  // closed mid-hover — otherwise the editor is left showing a frozen old
  // version with nothing on screen explaining why.
  useEffect(
    () => () => {
      cancelGrace();
      useStore.getState().clearVersionPreview();
    },
    [],
  );

  const versionAt = (idx: number): NoteVersion | null => rows[idx - 1] ?? null;

  const previewRow = (idx: number) => {
    cancelGrace();
    const v = versionAt(idx);
    if (!v) {
      // Row 0 ("Current") is the way back to the live buffer.
      useStore.getState().clearVersionPreview();
      return;
    }
    void useStore.getState().previewVersion(v.id);
  };

  const scheduleClearPreview = () => {
    cancelGrace();
    graceRef.current = window.setTimeout(() => {
      graceRef.current = null;
      useStore.getState().clearVersionPreview();
    }, PREVIEW_GRACE_MS);
  };

  const close = () => {
    cancelGrace();
    useStore.getState().closeRightPanel();
  };

  const doRevert = async (v: NoteVersion) => {
    // Leave preview first: the revert lands in the LIVE editor as a forward
    // CRDT edit, and watching it apply under a read-only overlay would read as
    // nothing having happened.
    cancelGrace();
    useStore.getState().clearVersionPreview();
    try {
      await useStore.getState().revertToVersion(v.id);
      toast(revertToastText(v.createdAt, Date.now()), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      e.preventDefault();
      return;
    }
    const next = nextActiveIndex(e.key, active, rowCount);
    if (next != null) {
      setActive(next);
      previewRow(next);
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      const v = versionAt(active);
      if (v) {
        void doRevert(v);
        e.preventDefault();
      }
    }
  };

  return (
    <div
      ref={asideRef}
      className="version-tab"
      tabIndex={-1}
      aria-label="버전 기록"
      onKeyDown={onKeyDown}
    >
      <header className="version-panel-head">
        <div className="version-panel-title">
          <span className="settings-eyebrow">버전 기록</span>
          <strong>{noteTitle ?? "이 노트"}</strong>
        </div>
      </header>

      <p className="muted version-panel-hint">
        버전에 마우스를 올리면 여기서 미리 볼 수 있어요. 되돌리기 전에 현재
        텍스트를 먼저 사본으로 남기므로 언제든 돌아올 수 있어요.
      </p>

      {versions == null ? (
        <div className="muted version-panel-empty">불러오는 중…</div>
      ) : (
        <ul className="version-list" ref={listRef} onMouseLeave={scheduleClearPreview}>
          <li
            data-idx={0}
            className={`version-row current-row${active === 0 ? " active" : ""}`}
            onMouseEnter={() => {
              setActive(0);
              previewRow(0);
            }}
          >
            <span className="version-dot" aria-hidden="true" />
            <span className="version-row-main">
              <span className="version-row-title">현재</span>
              <span className="version-row-sub">지금 편집기에 있는 내용</span>
            </span>
          </li>
          {rows.map((v, i) => (
            <VersionRow
              key={v.id}
              version={v}
              idx={i + 1}
              active={active === i + 1}
              isCurrent={liveSha != null && liveSha === v.sha256}
              now={now}
              onHover={() => {
                setActive(i + 1);
                previewRow(i + 1);
              }}
              onRevert={() => doRevert(v)}
            />
          ))}
          {rows.length === 0 && (
            <li className="muted version-panel-empty">
              아직 버전이 없어요. 편집을 멈추고 몇 분 뒤에 자동으로 저장되고,
              되돌리기 직전에도 항상 저장돼요.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function VersionRow({
  version,
  idx,
  active,
  isCurrent,
  now,
  onHover,
  onRevert,
}: {
  version: NoteVersion;
  idx: number;
  active: boolean;
  /** This stored version's text is byte-identical to the live buffer. */
  isCurrent: boolean;
  now: number;
  onHover: () => void;
  onRevert: () => Promise<void>;
}) {
  const author = versionAuthorLabel(version.authorName);
  const size = formatVersionSize(version.size);
  return (
    <li
      data-idx={idx}
      className={`version-row${active ? " active" : ""}${isCurrent ? " is-current" : ""}`}
      onMouseEnter={onHover}
    >
      <Face
        userId={version.authorId}
        name={version.authorName}
        className="version-avatar"
        ariaHidden
      />
      <span className="version-row-main">
        <span className="version-row-title">
          {agoFromIso(version.createdAt, now)}
          {isCurrent && <span className="version-badge">현재</span>}
        </span>
        <span className="version-row-sub">
          {author} · {versionCauseLabel(version.cause)}
          {size && ` · ${size}`}
        </span>
      </span>
      <AsyncButton
        className="link-btn version-revert"
        disabled={isCurrent}
        title={
          isCurrent
            ? "이미 노트의 현재 내용이에요"
            : "노트를 이 버전으로 바꾸기"
        }
        onClick={onRevert}
      >
        되돌리기
      </AsyncButton>
    </li>
  );
}
