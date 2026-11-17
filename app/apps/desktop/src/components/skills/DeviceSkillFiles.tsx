// A skill on this computer, shown in the same frame as a team skill's draft
// editor (file tree + CodeMirror + SKILL.md Name/Description), read only. Files
// come from Rust (`skills_list_device_skill_files`, `skills_read_device_skill_file`),
// which only reads inside the folders the device scan covers. Nothing here
// writes: the skill belongs to its own folder.

import { useEffect, useState } from "react";
import * as ipc from "../../lib/ipc";
import { buildFileTree, middleTruncate, visibleRows } from "../../lib/skills/fileTree";
import { readSkillHeader } from "../../lib/skills/skillMdEdit";
import { iconForPath } from "../FileTree";
import "../editor.css";
import { EditorBodySkeleton, EditorSkeleton, LoadError } from "./parts";
import { loadErrorText, withTimeout } from "../../lib/skills/loading";
import { SkillCodeEditor } from "./SkillCodeEditor";

type Listing = { status: "loading" } | { status: "ready"; files: ipc.DeviceSkillFile[]; truncated: boolean } | { status: "error"; message: string };
type FileText = { status: "loading" } | { status: "ready"; file: ipc.DeviceSkillFileText } | { status: "error"; message: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

const folderIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

export function DeviceSkillFiles({ path }: { path: string }) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [selected, setSelected] = useState("SKILL.md");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [texts, setTexts] = useState<Record<string, FileText>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setListing({ status: "loading" });
    withTimeout(ipc.skillsListDeviceSkillFiles(path)).then(
      (r) => {
        if (!cancelled) setListing({ status: "ready", files: r.files, truncated: r.truncated });
      },
      (e) => {
        if (!cancelled) setListing({ status: "error", message: loadErrorText(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  useEffect(() => {
    if (texts[selected]) return;
    setTexts((t) => ({ ...t, [selected]: { status: "loading" } }));
    withTimeout(ipc.skillsReadDeviceSkillFile(path, selected)).then(
      (file) => setTexts((t) => ({ ...t, [selected]: { status: "ready", file } })),
      (e) => setTexts((t) => ({ ...t, [selected]: { status: "error", message: loadErrorText(e) } })),
    );
  }, [path, selected, texts]);

  if (listing.status === "loading") return <EditorSkeleton />;
  if (listing.status === "error") {
    return <LoadError message={`이 스킬의 파일 목록을 불러오지 못했어요: ${listing.message}`} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  const files = listing.files;
  const current = files.find((f) => f.relPath === selected) ?? null;
  const tree = buildFileTree(files.map((f) => f.relPath));
  const rows = visibleRows(tree, collapsed);
  const state = texts[selected];
  const text = state?.status === "ready" ? state.file : null;
  const header = selected === "SKILL.md" && text?.text != null ? readSkillHeader(text.text) : null;

  return (
    <div className="skills-editor">
      <div className="skills-tree">
        <div className="skills-tree-head">
          <span>파일</span>
        </div>
        <ul className="skills-tree-list" role="tree">
          {rows.map(({ node, depth }) => {
            const pad = { paddingLeft: `${6 + depth * 14}px` };
            if (node.kind === "folder") {
              const open = !collapsed.has(node.path);
              return (
                <li key={`d:${node.path}`} role="treeitem" aria-expanded={open} className="skills-tree-row is-folder" style={pad}>
                  <button
                    type="button"
                    className="skills-tree-btn"
                    title={node.path}
                    onClick={() =>
                      setCollapsed((c) => {
                        const next = new Set(c);
                        if (open) next.add(node.path);
                        else next.delete(node.path);
                        return next;
                      })
                    }
                  >
                    <svg className={`skills-caret${open ? "" : " is-closed"}`} viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="skills-tree-icon">{folderIcon}</span>
                    <span className="skills-tree-name">{middleTruncate(node.name)}</span>
                  </button>
                </li>
              );
            }
            return (
              <li
                key={node.path}
                role="treeitem"
                aria-selected={node.path === selected}
                className={`skills-tree-row${node.path === selected ? " is-active" : ""}`}
                style={pad}
              >
                <button type="button" className="skills-tree-btn" title={node.path} onClick={() => setSelected(node.path)}>
                  <span className="skills-caret-space" aria-hidden="true" />
                  <span className="skills-tree-icon">{iconForPath(node.path)}</span>
                  <span className="skills-tree-name">{middleTruncate(node.name)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {listing.truncated && <div className="field-hint skills-tree-note">처음 {files.length}개 파일만 표시해요.</div>}
      </div>

      <div className="skills-pane">
        <div className="skills-pane-head">
          <span className="skills-pane-path" title={selected}>
            {selected}
            {current && <span className="skills-pane-size"> · {formatSize(current.size)}</span>}
          </span>
          <span className="skills-save-status">읽기 전용 · 해당 폴더에서 편집하세요</span>
        </div>

        {header && (
          <div className="skills-md-header">
            <span className="skills-md-label">이름</span>
            <span className="skills-md-name">{header.name ?? "—"}</span>
            <span className="skills-md-label">설명</span>
            <span className="skills-md-static">{header.description || "—"}</span>
          </div>
        )}

        <div className="skills-pane-body">
          {!state || state.status === "loading" ? (
            <EditorBodySkeleton />
          ) : state.status === "error" ? (
            <div className="skills-quiet">
              <LoadError
                message={`${selected} 파일을 읽지 못했어요: ${state.message}`}
                onRetry={() => setTexts(({ [selected]: _gone, ...rest }) => rest)}
              />
            </div>
          ) : state.file.binary || state.file.text === null ? (
            <div className="skills-quiet field-hint">
              바이너리 파일 ·{" "}
              <button className="link-btn skills-hint-link-inline" onClick={() => void ipc.revealInFileManager(`${path}/${selected}`)}>
                {ipc.revealLabel()}
              </button>
            </div>
          ) : (
            <SkillCodeEditor
              path={header ? `${selected}#body` : selected}
              value={header ? header.parts.body : state.file.text}
              onChange={() => {}}
              onSave={() => {}}
              readOnly
            />
          )}
        </div>

        {text?.truncated && (
          <div className="skills-pane-foot field-hint">파일의 앞부분만 표시해요. 전체 내용은 이보다 길어요.</div>
        )}
      </div>
    </div>
  );
}
