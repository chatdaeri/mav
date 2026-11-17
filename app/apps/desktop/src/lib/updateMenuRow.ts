/* The account menu's "Check for updates" row: what its right-hand hint says and
   which toast reports a check started from it. Pure, so it is testable without
   the Tauri updater; the texts mirror Account Settings → About, which runs the
   same `checkAndAutoInstall` and shows the same outcomes in its status line. */
import type { UpdateState } from "./updater";
import type { ToastTone } from "./toast";

/** Phases in which About's button is disabled: a check or install is running. */
export function isUpdateBusy(state: UpdateState): boolean {
  return (
    state.phase === "checking" ||
    state.phase === "available" ||
    state.phase === "downloading" ||
    state.phase === "installing" ||
    state.phase === "ready"
  );
}

/**
 * The row's hint. The running version (as About prints it) unless the updater
 * has something to say; `null` version means it has not been read yet, shown
 * as "…" like About.
 */
export function updateRowHint(state: UpdateState, version: string | null): string {
  switch (state.phase) {
    case "checking":
      return "확인 중…";
    case "available":
    case "downloading":
    case "installing":
      return "업데이트 중…";
    case "pending":
      return "업데이트 준비 중";
    case "ready":
      return "다시 시작하여 업데이트";
    default:
      return version ?? "…";
  }
}

/**
 * The toast for the first state a menu-started check settles in (anything but
 * `checking`), worded as About's status line. `null` for nothing to say.
 */
export function updateCheckToast(state: UpdateState): { text: string; tone: ToastTone } | null {
  switch (state.phase) {
    case "uptodate":
      return { text: "최신 버전을 사용 중이에요.", tone: "success" };
    case "pending":
      return { text: "업데이트가 곧 도착해요.", tone: "neutral" };
    case "available":
      return { text: `버전 ${state.version}을(를) 찾았어요. 다운로드를 시작해요…`, tone: "neutral" };
    case "error":
      return { text: `업데이트를 확인하지 못했어요: ${state.message}`, tone: "error" };
    case "failed":
      return {
        text: `버전 ${state.version} 설치에 실패했어요${state.message ? `: ${state.message}` : ""}`,
        tone: "error",
      };
    default:
      return null;
  }
}
