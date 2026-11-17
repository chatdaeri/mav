import type { UpdateState } from "./updater";

/**
 * One reading of the updater's state for every surface that shows it: the
 * About card, the sidebar line above the account row, and the account menu's
 * update row. They differ in size, never in what they say.
 */
export interface UpdateView {
  /** `ok` up to date, `busy` working, `ready` restart pending, `wait` on its way, `error`. */
  tone: "idle" | "ok" | "busy" | "ready" | "wait" | "error";
  /** "마브 0.1.98", "Updating to 0.1.99", "0.1.99 is ready". */
  title: string;
  /** The second line, or "". */
  sub: string;
  /** 0 to 100 while bytes are moving, else null. */
  percent: number | null;
  /** What the button does, or null for no button. */
  action: "check" | "restart" | "retry" | null;
}

export function updateView(state: UpdateState, current: string | null): UpdateView {
  const here = current ?? "…";
  switch (state.phase) {
    case "checking":
      return { tone: "busy", title: `마이 세컨드 브레인 ${here}`, sub: "업데이트 확인 중…", percent: null, action: null };
    case "available":
      return { tone: "busy", title: `${state.version}(으)로 업데이트 중`, sub: "다운로드를 시작하는 중…", percent: 0, action: null };
    case "downloading": {
      const percent = state.total > 0 ? Math.round((state.downloaded / state.total) * 100) : null;
      return {
        tone: "busy",
        title: `${state.version}(으)로 업데이트 중`,
        sub: percent === null ? "다운로드 중…" : `다운로드 중 · ${percent}%`,
        percent: percent ?? 0,
        action: null,
      };
    }
    case "installing":
      return { tone: "busy", title: `${state.version} 설치 중`, sub: "몇 초 걸려요", percent: 100, action: null };
    case "ready":
      return { tone: "ready", title: `${state.version} 준비됨`, sub: "다시 시작하면 완료돼요", percent: null, action: "restart" };
    case "uptodate":
      return { tone: "ok", title: `마이 세컨드 브레인 ${here}`, sub: "최신 버전이에요", percent: null, action: "check" };
    case "pending":
      return { tone: "wait", title: "업데이트가 곧 도착해요", sub: "마이 세컨드 브레인이 알아서 다시 확인해요", percent: null, action: null };
    case "error":
      return { tone: "error", title: `마이 세컨드 브레인 ${here}`, sub: `업데이트를 확인할 수 없어요: ${state.message}`, percent: null, action: "retry" };
    case "failed":
      return {
        tone: "error",
        title: `${state.version}을(를) 설치할 수 없어요`,
        sub: state.message || "다운로드가 중단됐어요",
        percent: null,
        action: "retry",
      };
    default:
      return { tone: "idle", title: `마이 세컨드 브레인 ${here}`, sub: "", percent: null, action: "check" };
  }
}

/** The sidebar line shows only while something is happening or waiting on you. */
export function showsSidebarUpdateLine(view: UpdateView): boolean {
  return view.tone === "busy" || view.tone === "ready" || view.tone === "error" || view.tone === "wait";
}
