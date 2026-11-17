// The folder-missing UI (#228): the banner, the Settings → Vaults row and the
// Reset local copy confirm. Rendered to static markup, like the other notices.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ResetLocalCopyDialog,
  VaultFolderMissingBannerView,
  VaultFolderMissingRowActions,
  folderMissingActions,
  resetLocalCopyCopy,
} from "../VaultFolderMissing";
import { sidebarPathLabel } from "../SidebarHeader";

const banner = (synced: boolean) =>
  renderToStaticMarkup(
    createElement(VaultFolderMissingBannerView, {
      show: true,
      synced,
      onRestore: vi.fn(),
      onLocate: vi.fn(),
      onSwitch: vi.fn(),
    }),
  );

describe("the folder-missing banner", () => {
  it("offers Restore here, Locate folder… and Switch vault for a synced vault", () => {
    const html = banner(true);
    expect(html).toContain("이 볼트의 폴더를 찾을 수 없어요.");
    expect(html).toContain("폴더가 이동·이름 변경·삭제된 것 같아요.");
    expect(html).toContain("여기에 복원");
    expect(html).toContain("폴더 찾기…");
    expect(html).toContain("볼트 전환");
    expect(html).not.toContain("Reopen vault");
    // Restore here leads.
    expect(html.indexOf("여기에 복원")).toBeLessThan(html.indexOf("폴더 찾기…"));
  });

  it("omits Restore here for a local-only vault", () => {
    const html = banner(false);
    expect(html).not.toContain("여기에 복원");
    expect(html).toContain("폴더 찾기…");
    expect(html).toContain("볼트 전환");
  });

  it("renders nothing while the folder is present", () => {
    const html = renderToStaticMarkup(
      createElement(VaultFolderMissingBannerView, {
        show: false,
        synced: true,
        onRestore: vi.fn(),
        onLocate: vi.fn(),
        onSwitch: vi.fn(),
      }),
    );
    expect(html).toBe("");
  });

  it("names the actions per vault kind", () => {
    expect(folderMissingActions(true)).toEqual(["restore", "locate"]);
    expect(folderMissingActions(false)).toEqual(["locate"]);
  });
});

describe("the Settings → Vaults row", () => {
  it("shows a Folder missing badge instead of Current, with the same actions", () => {
    const html = renderToStaticMarkup(
      createElement(VaultFolderMissingRowActions, {
        synced: true,
        onRestore: vi.fn(),
        onLocate: vi.fn(),
      }),
    );
    expect(html).toContain("폴더 없음");
    expect(html).not.toContain("Current");
    expect(html).toContain("여기에 복원");
    expect(html).toContain("폴더 찾기…");
  });

  it("offers only Locate folder… on a local vault's row", () => {
    const html = renderToStaticMarkup(
      createElement(VaultFolderMissingRowActions, {
        synced: false,
        onRestore: vi.fn(),
        onLocate: vi.fn(),
      }),
    );
    expect(html).toContain("폴더 없음");
    expect(html).not.toContain("여기에 복원");
    expect(html).toContain("폴더 찾기…");
  });
});

describe("the sidebar header path line", () => {
  it("says Folder missing instead of the path", () => {
    expect(sidebarPathLabel("/Users/ann/Documents/a", { switching: false, rootMissing: true })).toBe(
      "폴더 없음",
    );
    expect(sidebarPathLabel("/Users/ann/Documents/a", { switching: false, rootMissing: false })).toBe(
      "/Documents/a",
    );
  });
});

describe("the Reset local copy confirm", () => {
  it("says Reset when everything is on the server", () => {
    const copy = resetLocalCopyCopy([]);
    expect(copy.title).toBe("이 기기의 볼트를 초기화할까요?");
    expect(copy.body).toBe(
      "마이 세컨드 브레인이 이 기기의 볼트 폴더를 영구 삭제하고 원격 볼트에서 새 사본을 내려받아요. 팀에는 아무 영향이 없어요.",
    );
    expect(copy.warning).toBeNull();
    expect(copy.confirmLabel).toBe("초기화");
    const html = renderToStaticMarkup(
      createElement(ResetLocalCopyDialog, { unsynced: [], onConfirm: vi.fn(), onCancel: vi.fn() }),
    );
    expect(html).toContain("이 기기의 볼트를 초기화할까요?");
    expect(html).toContain("영구 삭제하고");
    expect(html).not.toContain("초기화하면 사라져요");
  });

  it("names unsynced notes and says Delete and reset", () => {
    const paths = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"];
    const copy = resetLocalCopyCopy(paths);
    expect(copy.warning).toBe("서버에 반영되지 않은 변경 사항이 있는 노트가 7개 있어요. 초기화하면 사라져요.");
    expect(copy.confirmLabel).toBe("삭제 후 초기화");
    expect(copy.shown).toEqual(paths.slice(0, 5));
    expect(copy.more).toBe(2);
    const html = renderToStaticMarkup(
      createElement(ResetLocalCopyDialog, { unsynced: paths, onConfirm: vi.fn(), onCancel: vi.fn() }),
    );
    expect(html).toContain("초기화하면 사라져요.");
    expect(html).toContain("a.md");
    expect(html).not.toContain("f.md");
    expect(html).toContain("외 2개");
    expect(html).toContain("삭제 후 초기화");
  });

  it("uses the singular for one note", () => {
    expect(resetLocalCopyCopy(["a.md"]).warning).toBe(
      "서버에 반영되지 않은 변경 사항이 있는 노트가 1개 있어요. 초기화하면 사라져요.",
    );
  });
});
