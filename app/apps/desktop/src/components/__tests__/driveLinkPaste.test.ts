import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({}));
vi.mock("../../store", () => ({ useStore: { getState: () => ({}) } }));

const { DriveLinkPaste, driveLinkPath } = await import("../viewers/DriveLinkPaste");

const render = (path: string, size: number | null) =>
  renderToStaticMarkup(createElement(DriveLinkPaste, { path, size }));

describe("DriveLinkPaste", () => {
  it("names the link file next to the original", () => {
    expect(driveLinkPath("콘텐츠/유튜브/최종본.mp4")).toBe("콘텐츠/유튜브/최종본 (드라이브 링크).url");
    expect(driveLinkPath("deck.pptx")).toBe("deck (드라이브 링크).url");
  });

  it("shows only for videos and files over 25MB", () => {
    expect(render("a.mp4", 10)).toContain("링크 만들기");
    expect(render("a.pptx", 26 * 1024 * 1024)).toContain("링크 만들기");
    expect(render("a.pptx", 1024)).toBe("");
    expect(render("a.mp4", null)).toBe("");
  });
});
