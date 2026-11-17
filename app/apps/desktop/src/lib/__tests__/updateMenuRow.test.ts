import { describe, expect, it } from "vitest";
import { isUpdateBusy, updateCheckToast, updateRowHint } from "../updateMenuRow";

describe("updateRowHint", () => {
  it("shows the running version when the updater has nothing to say", () => {
    expect(updateRowHint({ phase: "idle" }, "0.1.81")).toBe("0.1.81");
    expect(updateRowHint({ phase: "uptodate" }, "0.1.81-staging.42")).toBe("0.1.81-staging.42");
    expect(updateRowHint({ phase: "error", message: "offline" }, "0.1.81")).toBe("0.1.81");
    expect(updateRowHint({ phase: "idle" }, null)).toBe("…");
  });

  it("names a running check, an install, a pending release and a held restart", () => {
    expect(updateRowHint({ phase: "checking" }, "0.1.81")).toBe("확인 중…");
    expect(updateRowHint({ phase: "downloading", version: "0.1.82", downloaded: 1, total: 2 }, "0.1.81")).toBe(
      "업데이트 중…",
    );
    expect(updateRowHint({ phase: "pending", version: "0.1.82" }, "0.1.81")).toBe("업데이트 준비 중");
    expect(updateRowHint({ phase: "ready", version: "0.1.82" }, "0.1.81")).toBe("다시 시작하여 업데이트");
  });
});

describe("updateCheckToast", () => {
  it("words each settled outcome like About's status line", () => {
    expect(updateCheckToast({ phase: "uptodate" })).toEqual({
      text: "최신 버전을 사용 중이에요.",
      tone: "success",
    });
    expect(updateCheckToast({ phase: "pending", version: "0.1.82" })).toEqual({
      text: "업데이트가 곧 도착해요.",
      tone: "neutral",
    });
    expect(updateCheckToast({ phase: "available", version: "0.1.82" })?.text).toBe(
      "버전 0.1.82을(를) 찾았어요. 다운로드를 시작해요…",
    );
    expect(updateCheckToast({ phase: "error", message: "offline" })).toEqual({
      text: "업데이트를 확인하지 못했어요: offline",
      tone: "error",
    });
    expect(updateCheckToast({ phase: "idle" })).toBeNull();
  });
});

describe("isUpdateBusy", () => {
  it("matches the phases in which About disables its button", () => {
    expect(isUpdateBusy({ phase: "checking" })).toBe(true);
    expect(isUpdateBusy({ phase: "ready", version: "0.1.82" })).toBe(true);
    expect(isUpdateBusy({ phase: "pending", version: "0.1.82" })).toBe(false);
    expect(isUpdateBusy({ phase: "uptodate" })).toBe(false);
  });
});
