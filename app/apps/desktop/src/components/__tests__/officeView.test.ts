// OfficeBody renders the Rust preview model (`office_preview.rs`) as plain
// React elements. These pin the two safety rules — file strings are text, only
// `data:image/...;base64` pictures render — and the slide geometry.
//
// `OFFICE_HARNESS_MODEL=<model.json> OFFICE_HARNESS_OUT=<page.html>` also writes
// one real model as a standalone page with the app's CSS, for eyeballing a
// preview in a browser (the Rust `dump_real_files` test writes the JSON).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OfficePreview } from "../../lib/ipc";

vi.mock("../../lib/ipc", () => ({}));
vi.mock("../../store", () => ({ useStore: { getState: () => ({}) } }));

const { OfficeBody } = await import("../viewers/OfficeView");

const render = (model: OfficePreview) => renderToStaticMarkup(createElement(OfficeBody, { model }));

const doc = (blocks: OfficePreview["blocks"]): OfficePreview => ({
  kind: "document",
  blocks,
  slides: [],
  slideWidthPt: null,
  aspect: null,
  skippedImages: 0,
  truncated: false,
});

describe("OfficeBody", () => {
  it("renders file text as text, never as markup", () => {
    const html = render(
      doc([{ type: "para", text: "<script>alert(1)</script> 세컨브레인", bold: true, size: null, align: "center" }]),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("세컨브레인");
    expect(html).toContain("text-align:center");
  });

  it("only renders base64 data pictures of known raster types", () => {
    const html = render(
      doc([
        { type: "image", src: "data:image/png;base64,iVBORw0KGgo=" },
        { type: "image", src: "https://example.com/track.png" },
        { type: "image", src: "data:image/svg+xml;base64,PHN2Zz4=" },
      ]),
    );
    expect(html.match(/<img/g)?.length).toBe(1);
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("keeps table spans", () => {
    const html = render(
      doc([
        {
          type: "table",
          rows: [[{ colspan: 2, rowspan: 1, blocks: [{ type: "para", text: "칸", bold: false, size: null, align: null }] }]],
        },
      ]),
    );
    expect(html).toContain('colSpan="2"');
    expect(html).not.toContain("rowSpan");
  });

  it("positions slide boxes as percentages and scales type to the slide", () => {
    const html = render({
      kind: "slides",
      blocks: [],
      slides: [
        {
          shapes: [
            { x: 0.1, y: 0.2, w: 0.5, h: 0.25, blocks: [{ type: "para", text: "제목", bold: true, size: 48, align: null }] },
            { x: null, y: null, w: null, h: null, blocks: [{ type: "para", text: "본문", bold: false, size: null, align: null }] },
          ],
        },
      ],
      slideWidthPt: 960,
      aspect: 16 / 9,
      skippedImages: 0,
      truncated: false,
    });
    expect(html).toContain("left:10%;top:20%;width:50%;min-height:25%");
    expect(html).toContain("font-size:5cqw");
    expect(html).toContain('class="office-flow"');
    expect(html).toContain('class="office-slide-num">1<');
  });

  it.skipIf(!process.env.OFFICE_HARNESS_MODEL)("writes a harness page for one real model", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = ["../../styles/tokens.css", "../../App.css"]
      .map((p) => readFileSync(resolve(here, p), "utf8"))
      .join("\n");
    const model = JSON.parse(readFileSync(process.env.OFFICE_HARNESS_MODEL!, "utf8")) as OfficePreview;
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body{margin:0;background:var(--bg-primary,#fff);font-family:-apple-system,"Apple SD Gothic Neo",sans-serif}</style></head>
<body><div class="file-preview file-preview-office" style="height:auto"><div class="file-preview-body">${render(model)}</div></div></body></html>`;
    writeFileSync(process.env.OFFICE_HARNESS_OUT!, page);
  });
});
