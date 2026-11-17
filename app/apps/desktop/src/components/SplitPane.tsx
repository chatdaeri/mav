// 마브: the side pane — a READ-ONLY, live view of one vault file next to the
// editor. Links clicked in the editor open here.
//
// Why read-only: the app's sync model binds exactly one note to a live CRDT
// session (the main editor). This pane never creates one; it reads the file
// from disk and re-reads it on every `files-changed` for its path, so edits by
// the user, a teammate or Claude Code show up within the watcher's debounce.
// To edit, "여기서 편집" opens the file in the main editor. Nothing here can
// write, so the pane cannot diverge from — or fight — the real session.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { createEditorState } from "../lib/editor";
import { wikilinkClickAction } from "../lib/editor/wikilinkResolve";
import { formatFor } from "../lib/formats";
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { makeResolveAsset } from "./Editor";
import { FilePreview } from "./FilePreview";

const nfc = (s: string) => s.normalize("NFC");

function NoteView({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);

  // Read, and re-read whenever the watcher reports this path.
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    void ipc
      .readNote(path, useStore.getState().vault?.epoch)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, reload]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    void ipc
      .onFilesChanged((changes) => {
        if (changes.some((c) => nfc(c.path) === nfc(path))) setReload((n) => n + 1);
      })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [path]);

  useEffect(() => {
    if (content == null || !hostRef.current) return;
    const state = createEditorState({
      doc: content,
      collab: false,
      getTitles: () => useStore.getState().titles,
      // A [[wikilink]] in the side pane navigates the side pane.
      onNavigate: (target) => {
        void ipc.resolveWikilink(target).then((r) => {
          const action = wikilinkClickAction(r);
          if (action.kind === "open") useStore.getState().openSplit(action.path);
        });
      },
      resolveAsset: makeResolveAsset(useStore.getState().vault?.path ?? null, path),
      extraExtensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    return () => view.destroy();
  }, [content, path]);

  if (missing) return <div className="editor-empty">파일을 찾을 수 없어요.</div>;
  if (content == null) return <div className="editor-empty">불러오는 중…</div>;
  return <div className="split-pane-note" ref={hostRef} />;
}

export function SplitPane() {
  const path = useStore((s) => s.splitPath);
  if (!path) return null;
  const name = path.split("/").pop() ?? path;
  const isText = formatFor(path)?.viewer === "editor";
  const s = useStore.getState;

  return (
    <section className="mav-split-pane" data-split-path={path} aria-label={`${name} (옆 창)`}>
      <header className="split-pane-head">
        <span className="split-pane-title" title={path}>
          {name}
        </span>
        <button
          type="button"
          className="ghost-pill sm"
          onClick={() => {
            const p = path;
            s().closeSplit();
            void s().openNoteByPath(p);
          }}
        >
          여기서 편집
        </button>
        <button type="button" className="icon-btn" aria-label="옆 창 닫기" onClick={() => s().closeSplit()}>
          ✕
        </button>
      </header>
      <div className="split-pane-body">
        {isText ? <NoteView key={path} path={path} /> : <FilePreview key={path} path={path} />}
      </div>
    </section>
  );
}
