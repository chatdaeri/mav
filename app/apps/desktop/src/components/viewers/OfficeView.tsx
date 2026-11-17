// HWPX documents and PPTX decks, from the structured model Rust builds
// (`src-tauri/src/office_preview.rs`).
//
// Nothing from the file is ever parsed as HTML here: every string is a React
// text child (escaped), and the only URL is an image `src` that Rust built as
// `data:image/<png|jpeg|gif|webp|bmp>;base64,…` from the file's own media —
// re-checked below so a model that somehow carried anything else renders
// nothing. Fidelity is partial (no fonts, themes, charts or vector shapes), so
// the header says so and offers the real app.

import { useEffect, useState, type CSSProperties } from "react";
import { openAppLabel } from "../../lib/formats";
import { formatBytes } from "../../lib/health/format";
import * as ipc from "../../lib/ipc";
import type { OfficeBlock, OfficePreview, OfficeShape } from "../../lib/ipc";
import { useStore } from "../../store";
import { FileCard } from "./FileCard";
import type { ViewerProps } from "./types";

/** Above this we ask first: building the model and decoding pictures is real
 *  work, and a mis-click in the sidebar never asked for it. */
export const OFFICE_CONFIRM_BYTES = 15 * 1024 * 1024;

const SAFE_IMAGE =
  /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/;

const REASONS: Record<string, string> = {
  preview_too_large: "파일이 커서 미리보기를 만들 수 없어요.",
  preview_unreadable: "이 파일을 읽을 수 없어요.",
  preview_unsupported: "미리보기를 지원하지 않는 형식이에요.",
};

function reasonFor(e: unknown): string {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return REASONS[msg] ?? "미리보기를 만들지 못했어요.";
}

function Blocks({
  blocks,
  slidePt,
}: {
  blocks: OfficeBlock[];
  slidePt?: number;
}) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} slidePt={slidePt} />
      ))}
    </>
  );
}

function BlockView({
  block,
  slidePt,
}: {
  block: OfficeBlock;
  slidePt?: number;
}) {
  if (block.type === "para") {
    const style: CSSProperties = {};
    if (block.bold) style.fontWeight = 600;
    if (block.align)
      style.textAlign = block.align as CSSProperties["textAlign"];
    // On a slide, sizes scale with the slide's width (container query units).
    if (slidePt && block.size)
      style.fontSize = `${(block.size / slidePt) * 100}cqw`;
    return (
      <p className="office-para" style={style}>
        {block.text}
      </p>
    );
  }
  if (block.type === "image") {
    if (!SAFE_IMAGE.test(block.src)) return null;
    return (
      <img className="office-img" src={block.src} alt="" draggable={false} />
    );
  }
  return (
    <table className="office-table">
      <tbody>
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td
                key={c}
                colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
              >
                <Blocks blocks={cell.blocks} slidePt={slidePt} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pct = (v: number) => `${Math.max(-50, Math.min(150, v * 100))}%`;

function SlideView({
  shapes,
  aspect,
  slidePt,
  n,
}: {
  shapes: OfficeShape[];
  aspect: number;
  slidePt: number;
  n: number;
}) {
  const placed = shapes.filter(
    (s) => s.x != null && s.y != null && s.w != null && s.h != null,
  );
  const flowing = shapes.filter((s) => !placed.includes(s));
  return (
    <figure className="office-slide-wrap">
      <div className="office-slide" style={{ aspectRatio: String(aspect) }}>
        {placed.map((s, i) => {
          // PowerPoint grows text boxes and table rows to fit their text, so a
          // stored frame is a floor for those; only a picture keeps its box.
          const picture = s.blocks.every((b) => b.type === "image");
          return (
            <div
              key={i}
              className={
                picture ? "office-shape office-shape-pic" : "office-shape"
              }
              style={{
                left: pct(s.x!),
                top: pct(s.y!),
                width: pct(s.w!),
                ...(picture ? { height: pct(s.h!) } : { minHeight: pct(s.h!) }),
              }}
            >
              <Blocks blocks={s.blocks} slidePt={slidePt} />
            </div>
          );
        })}
        {flowing.length > 0 && (
          <div className="office-flow">
            {flowing.map((s, i) => (
              <div key={i} className="office-shape-flow">
                <Blocks blocks={s.blocks} slidePt={slidePt} />
              </div>
            ))}
          </div>
        )}
      </div>
      <figcaption className="office-slide-num">{n}</figcaption>
    </figure>
  );
}

/** The rendered model, without loading or chrome (also used by tests). */
export function OfficeBody({ model }: { model: OfficePreview }) {
  if (model.kind === "slides") {
    return (
      <div className="office-slides">
        {model.slides.map((s, i) => (
          <SlideView
            key={i}
            n={i + 1}
            shapes={s.shapes}
            aspect={model.aspect ?? 16 / 9}
            slidePt={model.slideWidthPt ?? 960}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="file-doc office-doc">
      <Blocks blocks={model.blocks} />
    </div>
  );
}

export function OfficeView({ path, abs }: ViewerProps) {
  const [model, setModel] = useState<OfficePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [askSize, setAskSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setError(null);
    setAskSize(null);
    const epoch = useStore.getState().vault?.epoch;
    void (async () => {
      try {
        const stat = await ipc.fileStat(path, epoch);
        if (cancelled) return;
        if (stat.size > OFFICE_CONFIRM_BYTES && !confirmed) {
          setAskSize(stat.size);
          return;
        }
        const result = await ipc.officePreview(path, epoch);
        if (!cancelled) setModel(result);
      } catch (e) {
        if (!cancelled) {
          console.error("office preview failed", e);
          setError(reasonFor(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, confirmed]);

  if (error) return <FileCard path={path} abs={abs} reason={error} />;

  const notes: string[] = ["원본 서식과 다르게 보일 수 있어요"];
  if (model?.skippedImages) notes.push(`그림 ${model.skippedImages}개 생략`);
  if (model?.truncated) notes.push("일부만 표시");

  return (
    <div
      className="file-preview file-preview-office"
      data-viewer={path.toLowerCase().endsWith(".pptx") ? "pptx" : "hwpx"}
    >
      <div className="office-bar">
        <span className="office-bar-note">{notes.join(" · ")}</span>
        <button
          type="button"
          className="ghost-pill sm"
          onClick={() => void ipc.openInFileManager(abs)}
        >
          {openAppLabel(path)}
        </button>
      </div>
      <div className="file-preview-body">
        {askSize != null ? (
          <div className="file-ask">
            <p>
              {formatBytes(askSize)} 파일이에요. 미리보기에 몇 초 걸릴 수
              있어요.
            </p>
            <button
              type="button"
              className="primary sm"
              onClick={() => setConfirmed(true)}
            >
              미리보기 만들기
            </button>
          </div>
        ) : model == null ? (
          <div className="editor-empty">불러오는 중…</div>
        ) : (
          <OfficeBody model={model} />
        )}
      </div>
    </div>
  );
}
