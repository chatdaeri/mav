import { describe, expect, it } from "vitest";
import { overallState, stateLines, targetStates, teamAvailability } from "../installState";
import type { SkillTargetResult } from "../syncEngine";

const r = (target: "claude" | "agents", state: SkillTargetResult["state"], skillId = "s"): SkillTargetResult => ({
  orgId: "o", skillId, name: "n", target, state,
});

describe("targetStates / overallState", () => {
  it("reads each folder, honouring the folder switches", () => {
    const st = targetStates([r("claude", "upToDate"), r("agents", "edited"), r("claude", "failed", "other")], { claude: true, agents: true }, "o", "s");
    expect(st).toEqual({ claude: "installed", agents: "edited" });
    expect(overallState(st)).toBe("warn");
    expect(targetStates([r("claude", "upToDate")], { claude: true, agents: false }, "o", "s")).toEqual({ claude: "installed", agents: "off" });
  });

  it("ranks failed over edited over updating over installed", () => {
    expect(overallState({ claude: "failed", agents: "edited" })).toBe("bad");
    expect(overallState({ claude: "updating", agents: "installed" })).toBe("updating");
    expect(overallState({ claude: "keptMine", agents: "off" })).toBe("installed");
    expect(overallState({ claude: "missing", agents: "off" })).toBe("none");
  });

  it("writes one tooltip line per tool", () => {
    expect(stateLines({ claude: "installed", agents: "off" }, 2)).toEqual([
      "Claude: 설치됨 v2",
      "Codex 및 기타 도구: 꺼짐",
    ]);
  });
});

describe("teamAvailability", () => {
  const all = { claude: true, codex: true, cursor: true, gemini: true };
  it("maps folders to tools; Cursor reads both", () => {
    const a = teamAvailability({ claude: "installed", agents: "off" }, true, all);
    expect(a.map((x) => [x.tool, x.on])).toEqual([["claude", true], ["codex", false], ["cursor", true], ["gemini", false]]);
    expect(a[1].reason).toBe("Codex 및 기타 도구 폴더가 AI 도구에서 꺼져 있어요");
  });
  it("explains why not", () => {
    expect(teamAvailability({ claude: "missing", agents: "missing" }, false, all)[0].reason).toMatch(/이 컴퓨터에 없음/);
    expect(teamAvailability({ claude: "installed", agents: "installed" }, true, { ...all, gemini: false })[3].reason).toBe("Gemini가 설치되어 있지 않아요");
    expect(teamAvailability({ claude: "edited", agents: "conflict" }, true, all).map((x) => x.reason)).toEqual([
      "여기서 수정됨", "다른 스킬이 이름을 사용 중", "여기서 수정됨", "다른 스킬이 이름을 사용 중",
    ]);
  });
});
