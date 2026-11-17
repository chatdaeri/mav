// What a team skill looks like on THIS computer, per tool folder and overall:
// the source of the Skills tab's install button (+ / ✓ / !) and its tool-logo
// cluster. Pure, pinned by `__tests__/installState.test.ts`.

import type { SkillTarget } from "../ipc";
import type { SkillTargetResult } from "./syncEngine";

export type TargetState = "installed" | "updating" | "edited" | "keptMine" | "conflict" | "failed" | "off" | "missing";

export type Overall = "installed" | "updating" | "warn" | "bad" | "none";

export const TARGET_LABEL: Record<SkillTarget, string> = {
  claude: "Claude",
  agents: "Codex 및 기타 도구",
};

/** Each tool folder's state for one skill. `on` = the folder's switch in AI tools. */
export function targetStates(
  results: readonly SkillTargetResult[],
  on: Record<SkillTarget, boolean>,
  orgId: string,
  skillId: string,
): Record<SkillTarget, TargetState> {
  const one = (target: SkillTarget): TargetState => {
    if (!on[target]) return "off";
    const r = results.find((x) => x.orgId === orgId && x.skillId === skillId && x.target === target);
    if (!r) return "missing";
    return r.state === "upToDate" ? "installed" : r.state;
  };
  return { claude: one("claude"), agents: one("agents") };
}

/** The most important thing to say about the whole skill on this computer. */
export function overallState(states: Record<SkillTarget, TargetState>): Overall {
  const all = Object.values(states);
  if (all.includes("failed")) return "bad";
  if (all.includes("edited") || all.includes("conflict")) return "warn";
  if (all.includes("updating")) return "updating";
  if (all.some((s) => s === "installed" || s === "keptMine")) return "installed";
  return "none";
}

const STATE_TEXT: Record<TargetState, string> = {
  installed: "설치됨",
  updating: "업데이트 중",
  edited: "여기서 수정됨",
  keptMine: "내가 수정한 사본",
  conflict: "다른 스킬이 이름을 사용 중",
  failed: "설치하지 못함",
  off: "꺼짐",
  missing: "설치 안 됨",
};

/** "Claude: Installed v2" lines for a tooltip. */
export function stateLines(states: Record<SkillTarget, TargetState>, version: number | null): string[] {
  return (Object.keys(states) as SkillTarget[]).map((t) => {
    const s = states[t];
    return `${TARGET_LABEL[t]}: ${STATE_TEXT[s]}${s === "installed" && version !== null ? ` v${version}` : ""}`;
  });
}

// ---- "Available in" (a skill page's line of AI tools) ----------------------

export type AiTool = "claude" | "codex" | "cursor" | "gemini";

export const AI_TOOLS: readonly AiTool[] = ["claude", "codex", "cursor", "gemini"];

export const AI_TOOL_NAME: Record<AiTool, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
};

/** Which 마브 install folders each tool reads (Cursor reads both). */
export const TOOL_TARGETS: Record<AiTool, readonly SkillTarget[]> = {
  claude: ["claude"],
  codex: ["agents"],
  cursor: ["agents", "claude"],
  gemini: ["agents"],
};

export interface ToolAvailability {
  tool: AiTool;
  /** Installed or readable for that tool on this computer. */
  on: boolean;
  /** Why not, for the faded logo's tooltip. */
  reason: string | null;
  /** A note for an available tool's tooltip (Codex: only new chats see it). */
  note?: string;
}

const LIVE: ReadonlySet<TargetState> = new Set(["installed", "keptMine", "updating"]);

/**
 * A team skill per AI tool on this computer. `optedIn` is false for an Optional
 * skill not turned on here; `detected` says which tools are installed at all.
 */
export function teamAvailability(
  states: Record<SkillTarget, TargetState>,
  optedIn: boolean,
  detected: Record<AiTool, boolean>,
): ToolAvailability[] {
  return AI_TOOLS.map((tool) => {
    const targets = TOOL_TARGETS[tool];
    if (!optedIn) return { tool, on: false, reason: "이 컴퓨터에 없음 · +를 눌러 설치" };
    if (!detected[tool]) return { tool, on: false, reason: `${AI_TOOL_NAME[tool]}가 설치되어 있지 않아요` };
    if (targets.some((t) => LIVE.has(states[t]))) {
      return tool === "codex"
        ? { tool, on: true, reason: null, note: "설치됨 · 새 Codex 대화부터 적용돼요" }
        : { tool, on: true, reason: null };
    }
    const s = targets.map((t) => states[t]);
    const reason = s.includes("edited")
      ? "여기서 수정됨"
      : s.includes("conflict")
        ? "다른 스킬이 이름을 사용 중"
        : s.includes("failed")
          ? "설치하지 못함"
          : s.every((x) => x === "off")
            ? `${targets.map((t) => TARGET_LABEL[t]).join(", ")} 폴더가 AI 도구에서 꺼져 있어요`
            : "아직 설치 안 됨";
    return { tool, on: false, reason };
  });
}

/** Which AI tools this computer has, from Rust's target detection. */
export function detectedAiTools(targets: readonly { target: SkillTarget; toolInstalled: boolean; detectedTools: string[] }[]): Record<AiTool, boolean> {
  const claude = targets.find((t) => t.target === "claude");
  const agents = targets.find((t) => t.target === "agents");
  const has = (id: string) => !!agents?.detectedTools.includes(id);
  return { claude: !!claude?.toolInstalled, codex: has("codex"), cursor: has("cursor"), gemini: has("gemini") };
}
