import { describe, expect, it } from "vitest";
import { requiredTip, tipFromTitle, tipText } from "../SquareTip";

describe("install square tips", () => {
  it("a title's first line is the heading, the rest are lines", () => {
    expect(tipFromTitle("On this computer · click to remove\nClaude: Installed v1\nOther tools: Off")).toEqual({
      heading: "On this computer · click to remove",
      lines: ["Claude: Installed v1", "Other tools: Off"],
    });
    expect(tipFromTitle("Use on this computer")).toEqual({ heading: "Use on this computer", lines: [] });
  });

  it("Required says why it can't be removed, and where admins change it", () => {
    const member = requiredTip(["Claude: Installed v1"], false);
    expect(member.heading).toBe("팀에서 필수로 지정했어요");
    expect(member.body).toBe("모든 멤버의 컴퓨터에 항상 설치되고 제거할 수 없어요.");
    expect(member.note).toBeUndefined();
    expect(requiredTip([], true).note).toBe("스킬 페이지에서 선택으로 바꿀 수 있어요.");
    expect(tipText(member)).toBe(
      "팀에서 필수로 지정했어요. 모든 멤버의 컴퓨터에 항상 설치되고 제거할 수 없어요. Claude: Installed v1",
    );
  });
});
