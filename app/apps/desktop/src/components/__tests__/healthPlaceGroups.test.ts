// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalOnlyGroup, PRO_FILES_LINE, RemoteOnlyGroup, placeRows } from "../HealthPlaceGroups";
import type { HealthActions, HealthInventory } from "../../lib/health/types";

let container: HTMLDivElement;
let root: Root;
const actions = {
  syncNow: vi.fn(async () => {}),
  retryLocalFiles: vi.fn(async () => {}),
  deleteLocalFiles: vi.fn(async (paths: string[]) => ({ deleted: paths, failed: [] })),
  downloadFiles: vi.fn(async () => {}),
  removeServerFile: vi.fn(async () => {}),
} as unknown as HealthActions & Record<string, ReturnType<typeof vi.fn>>;

const inventory: HealthInventory = {
  local: { notes: 0, folders: 0, files: 0, total: 0 },
  localReady: true,
  server: { notes: 0, folders: 0, files: 0, total: 0 },
  serverState: "current",
  deviceOnlyNotes: ["b.md", "a.md"],
  deviceOnlyFolders: ["Dir"],
  deviceOnlyFiles: ["z.pdf", "y.png"],
  serverOnlyNotes: ["r.md"],
  serverOnlyFolders: [],
  serverOnlyFiles: ["s.pdf"],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent === label);
async function click(label: string, scope: ParentNode = container) {
  const b = button(label, scope);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
}

describe("placeRows", () => {
  it("orders notes, folders, files, alphabetical within each", () => {
    expect(placeRows(["b.md", "a.md"], ["Dir"], ["z.pdf", "y.png"]).map((r) => r.path))
      .toEqual(["a.md", "b.md", "Dir", "y.png", "z.pdf"]);
  });
});

describe("Only on this computer", () => {
  it("puts a checkbox on every row and names the selection in the delete confirm", async () => {
    await act(async () => root.render(createElement(LocalOnlyGroup, {
      inventory, actions, filesBlocked: true, onOpen: vi.fn(), onShow: vi.fn(), stale: false,
    })));
    expect(container.textContent).toContain("이 컴퓨터에만 있음 · 5개 항목");
    expect(container.textContent).toContain(PRO_FILES_LINE);
    expect(button("파일 선택")).toBeUndefined();
    // Notes, folders and files are all selectable.
    for (const p of ["a.md", "b.md", "Dir", "y.png", "z.pdf"]) {
      expect(container.querySelector(`input[aria-label="${p} 선택"]`), p).not.toBeNull();
    }
    expect(button("선택 항목 삭제 (1)")).toBeUndefined();
    const check = async (p: string) =>
      act(async () => (container.querySelector(`input[aria-label="${p} 선택"]`) as HTMLInputElement).click());
    await check("a.md");
    await check("Dir");
    await check("y.png");
    await click("선택 항목 삭제 (3)");
    expect(actions.deleteLocalFiles).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("이 컴퓨터에서 노트 1개, 폴더 1개, 파일 1개를 삭제할까요?");
    expect(dialog.textContent).toContain("이 컴퓨터에만 있어요");
    expect(dialog.textContent).toContain("폴더는 안에 든 모든 항목과 함께 삭제돼요.");
    await click("삭제", dialog);
    expect(actions.deleteLocalFiles).toHaveBeenCalledWith(["a.md", "Dir", "y.png"]);
  });

  it("leaves out the folder warning when no folder is selected, and Select all picks everything", async () => {
    await act(async () => root.render(createElement(LocalOnlyGroup, {
      inventory, actions, filesBlocked: false, onOpen: vi.fn(), onShow: vi.fn(), stale: false,
    })));
    expect(container.textContent).not.toContain(PRO_FILES_LINE);
    await act(async () => (container.querySelector('input[aria-label="b.md 선택"]') as HTMLInputElement).click());
    await click("선택 항목 삭제 (1)");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("이 컴퓨터에서 노트 1개를 삭제할까요?");
    expect(dialog.textContent).not.toContain("폴더는 안에 든");
    await click("취소", dialog);
    await click("모두 선택");
    expect(button("선택 항목 삭제 (5)")).toBeDefined();
  });
});

describe("Only on the Remote Vault", () => {
  it("selects files only and offers bulk download and removal", async () => {
    await act(async () => root.render(createElement(RemoteOnlyGroup, {
      inventory: { ...inventory, serverOnlyFiles: ["s.pdf", "t.png"] },
      actions, downloadsBlocked: false, showCheckAgain: true, stale: false,
    })));
    expect(container.textContent).toContain("원격 볼트에만 있음 · 3개 항목");
    expect(container.querySelector('input[aria-label="r.md 선택"]')).toBeNull();
    expect(container.querySelector(".health-place-checkslot")).not.toBeNull();
    await click("모두 다운로드");
    expect(actions.downloadFiles).toHaveBeenLastCalledWith(["s.pdf", "t.png"]);
    await act(async () => (container.querySelector('input[aria-label="t.png 선택"]') as HTMLInputElement).click());
    await click("선택 항목 다운로드 (1)");
    expect(actions.downloadFiles).toHaveBeenLastCalledWith(["t.png"]);
    await act(async () => (container.querySelector('input[aria-label="s.pdf 선택"]') as HTMLInputElement).click());
    await click("서버에서 제거 (1)");
    expect(actions.removeServerFile).not.toHaveBeenCalled();
    await click("서버에서 제거", document.querySelector('[role="alertdialog"]')!);
    expect(actions.removeServerFile).toHaveBeenCalledWith("s.pdf");
  });

  it("uses the shared Team line and hides downloads when blocked", async () => {
    await act(async () => root.render(createElement(RemoteOnlyGroup, {
      inventory, actions, downloadsBlocked: true, showCheckAgain: false, stale: false,
    })));
    expect(container.textContent).toContain(PRO_FILES_LINE);
    expect(button("다운로드")).toBeUndefined();
    expect(button("모두 다운로드")).toBeUndefined();
    await act(async () => (container.querySelector('input[aria-label="s.pdf 선택"]') as HTMLInputElement).click());
    expect(button("선택 항목 다운로드 (1)")).toBeUndefined();
    expect(button("서버에서 제거 (1)")).toBeDefined();
  });
});
