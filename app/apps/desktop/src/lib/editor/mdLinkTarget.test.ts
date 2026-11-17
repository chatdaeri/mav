import { describe, expect, it } from "vitest";
import { mdLinkAction, normalizeRelPath } from "./mdLinkTarget";

const ROOT = "/Users/me/mav/세컨브레인";

describe("mdLinkAction", () => {
  it("resolves angle-bracket relative links against the note's folder", () => {
    expect(mdLinkAction("<콘텐츠/content.md>", "AGENTS.md", ROOT)).toEqual({
      kind: "open",
      path: "콘텐츠/content.md",
    });
    expect(mdLinkAction("<content--유튜브.md>", "콘텐츠/content.md", ROOT)).toEqual({
      kind: "open",
      path: "콘텐츠/content--유튜브.md",
    });
    expect(mdLinkAction("../재무/financial.md", "콘텐츠/content.md", ROOT)).toEqual({
      kind: "open",
      path: "재무/financial.md",
    });
  });

  it("decodes %20 and drops #headings and ?queries", () => {
    expect(mdLinkAction("원본/My%20Deck.pptx#slide-2", "개발운영/dev.md", ROOT)).toEqual({
      kind: "open",
      path: "개발운영/원본/My Deck.pptx",
    });
  });

  it("reveals folders instead of opening them", () => {
    expect(mdLinkAction("<원본/>", "콘텐츠/content.md", ROOT)).toEqual({
      kind: "reveal",
      path: "콘텐츠/원본",
    });
    expect(mdLinkAction("<유튜브/발행본>", "콘텐츠/content.md", ROOT)).toEqual({
      kind: "reveal",
      path: "콘텐츠/유튜브/발행본",
    });
  });

  it("sends URLs out and keeps same-note anchors inert", () => {
    expect(mdLinkAction("https://chatdaeri.com", "a.md", ROOT)).toEqual({
      kind: "external",
      url: "https://chatdaeri.com",
    });
    expect(mdLinkAction("mailto:a@b.c", "a.md", ROOT).kind).toBe("external");
    expect(mdLinkAction("#제목", "a.md", ROOT)).toEqual({ kind: "none" });
  });

  it("maps absolute paths inside the vault, hands others to the OS", () => {
    expect(mdLinkAction(`<${ROOT}/콘텐츠/content.md>`, "a.md", ROOT)).toEqual({
      kind: "open",
      path: "콘텐츠/content.md",
    });
    expect(mdLinkAction("</Users/me/projects/output/초안.md>", "a.md", ROOT)).toEqual({
      kind: "os-path",
      path: "/Users/me/projects/output/초안.md",
    });
    expect(mdLinkAction("file:///Users/me/x%20y.pdf", "a.md", ROOT)).toEqual({
      kind: "os-path",
      path: "/Users/me/x y.pdf",
    });
  });

  it("refuses links that climb out of the vault", () => {
    expect(mdLinkAction("../../etc/passwd", "a/b.md", ROOT)).toEqual({ kind: "none" });
    expect(normalizeRelPath("a/./b/../c")).toBe("a/c");
    expect(normalizeRelPath("../x")).toBeNull();
  });
});
