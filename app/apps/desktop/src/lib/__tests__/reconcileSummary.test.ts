import { describe, expect, it } from "vitest";
import { dedupeReconcileItems, summarizeReconcile } from "../reconcileSummary";
import type { ReconcileItem } from "../sync/reconcileReport";

const at = 1_700_000_000_000;
const item = (i: Partial<ReconcileItem> & Pick<ReconcileItem, "kind" | "path">): ReconcileItem => ({
  at,
  ...i,
});

describe("summarizeReconcile", () => {
  it("returns nothing for no items", () => {
    expect(summarizeReconcile([])).toEqual([]);
  });

  it("writes one line per kind, with counts and plurals", () => {
    const lines = summarizeReconcile([
      item({ kind: "deletedByTeammate", path: "a.md", docId: "1" }),
      item({ kind: "deletedByTeammate", path: "b.md", docId: "2" }),
      item({ kind: "restoredFromServer", path: "c.md", docId: "3" }),
      item({ kind: "renamedConflict", path: "Notes/plan.md", newPath: "Notes/plan (2).md", docId: "4" }),
      item({ kind: "keptLocally", path: "d.md", docId: "5" }),
      item({ kind: "folderKept", path: "Projects/Q3" }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "오프라인에서 수정한 노트 2개를 팀원이 삭제했어요. 내 버전은 휴지통에 있어요.",
      "노트 1개는 이 기기에만 남아 있어요. 더 이상 접근 권한이 없어요.",
      "삭제한 노트 1개가 서버에 반영되지 않아 되돌려 놓았어요. 모두에게서 지우려면 다시 삭제하세요.",
      "충돌을 피하려고 노트 1개의 이름을 바꿨어요: plan.md → plan (2).md",
      "폴더 Q3에 노트를 추가해서 폴더를 유지했어요.",
    ]);
    expect(lines.map((l) => l.count)).toEqual([2, 1, 1, 1, 1]);
  });

  it("uses singular wording for one and plural for many", () => {
    const one = summarizeReconcile([item({ kind: "deletedByTeammate", path: "a.md", docId: "1" })]);
    expect(one[0].text).toBe(
      "오프라인에서 수정한 노트 1개를 팀원이 삭제했어요. 내 버전은 휴지통에 있어요.",
    );
    const many = summarizeReconcile([
      item({ kind: "restoredFromServer", path: "a.md", docId: "1" }),
      item({ kind: "restoredFromServer", path: "b.md", docId: "2" }),
      item({ kind: "renamedConflict", path: "x.md", newPath: "x 2.md", docId: "3" }),
      item({ kind: "renamedConflict", path: "y.md", newPath: "y 2.md", docId: "4" }),
      item({ kind: "folderKept", path: "A" }),
      item({ kind: "folderKept", path: "B" }),
    ]);
    expect(many.map((l) => l.text)).toEqual([
      "삭제한 노트 2개가 서버에 반영되지 않아 되돌려 놓았어요. 모두에게서 지우려면 다시 삭제하세요.",
      "팀원의 노트와 충돌하지 않도록 노트 2개의 이름을 바꿨어요.",
      "노트를 추가한 폴더 2개를 유지했어요.",
    ]);
  });

  it("counts a repeated record of the same outcome once", () => {
    const lines = summarizeReconcile([
      item({ kind: "restoredFromServer", path: "a.md", docId: "1" }),
      item({ kind: "restoredFromServer", path: "a.md", docId: "1", at: at + 5 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].count).toBe(1);
  });
});

describe("keptLocally, read-only", () => {
  it("counts revoked attachments and points to recovery copies", () => {
    const [line] = summarizeReconcile([
      item({ kind: "keptLocally", path: "report.pdf", detail: ".context/trash/s/report.pdf" }),
      item({ kind: "keptLocally", path: "image.png", detail: ".context/trash/s/image.png" }),
    ]);
    expect(line.count).toBe(2);
    expect(line.text).toContain("파일 2개를 .context/trash로 옮겼어요");
    expect(line.text).toContain("활동");
  });
  const RO = "read-only: your edit was not accepted; a copy is in .context/trash";
  it("does not claim lost access for a read-only rejection", () => {
    const [line] = summarizeReconcile([item({ kind: "keptLocally", path: "a.md", docId: "1", detail: RO })]);
    expect(line.text).toBe(
      "노트 1개는 보기만 가능해서 내 수정이 반영되지 않았어요. 사본은 .context/trash에 있어요.",
    );
  });
  it("keeps the access wording when nothing was read-only, and blends a mixed group", () => {
    const [plain] = summarizeReconcile([item({ kind: "keptLocally", path: "a.md", docId: "1" })]);
    expect(plain.text).toBe("노트 1개는 이 기기에만 남아 있어요. 더 이상 접근 권한이 없어요.");
    const [mixed] = summarizeReconcile([
      item({ kind: "keptLocally", path: "a.md", docId: "1" }),
      item({ kind: "keptLocally", path: "b.md", docId: "2", detail: RO }),
    ]);
    expect(mixed.text).toBe(
      "노트 2개는 이 기기에만 남아 있어요. 더 이상 접근 권한이 없거나 보기만 가능해요. 사본은 .context/trash에 있어요.",
    );
  });
  it("describes notes and binaries separately when one group mixes them", () => {
    const [line] = summarizeReconcile([
      item({ kind: "keptLocally", path: "a.md", docId: "1", detail: RO }),
      item({ kind: "keptLocally", path: "report.pdf", detail: ".context/trash/s/report.pdf" }),
    ]);
    expect(line.count).toBe(2);
    expect(line.text).toBe(
      "노트 1개는 보기만 가능해서 내 수정이 반영되지 않았어요. 사본은 .context/trash에 있어요. " +
        "접근 권한이 제거되어 파일 1개를 .context/trash로 옮겼어요. 복구용 사본은 활동에서 찾을 수 있어요.",
    );
  });
});

describe("externalEditSaved", () => {
  it("says the other app's version was saved to trash", () => {
    const one = summarizeReconcile([
      item({ kind: "externalEditSaved", path: "a.md", detail: ".context/trash/x/a.md" }),
    ]);
    expect(one.map((l) => l.text)).toEqual([
      "오프라인 중 다른 앱에서 바뀐 노트 1개를 병합하지 못했어요. 내 버전은 .context/trash에 저장했어요.",
    ]);
    const two = summarizeReconcile([
      item({ kind: "externalEditSaved", path: "a.md" }),
      item({ kind: "externalEditSaved", path: "b.md" }),
    ]);
    expect(two[0].text).toBe(
      "오프라인 중 다른 앱에서 바뀐 노트 2개를 병합하지 못했어요. 내 버전은 .context/trash에 저장했어요.",
    );
  });

  it("sorts right after the kept-on-this-device line", () => {
    const kinds = summarizeReconcile([
      item({ kind: "restoredFromServer", path: "r.md", docId: "r" }),
      item({ kind: "externalEditSaved", path: "e.md" }),
      item({ kind: "keptLocally", path: "k.md", docId: "k" }),
    ]).map((l) => l.kind);
    expect(kinds).toEqual(["keptLocally", "externalEditSaved", "restoredFromServer"]);
  });
});

describe("dedupeReconcileItems", () => {
  it("keeps the latest record per kind and doc", () => {
    const out = dedupeReconcileItems([
      item({ kind: "keptLocally", path: "a.md", docId: "1" }),
      item({ kind: "restoredFromServer", path: "a.md", docId: "1" }),
      item({ kind: "keptLocally", path: "a.md", docId: "1", at: at + 9 }),
    ]);
    expect(out.map((i) => [i.kind, i.at])).toEqual([
      ["restoredFromServer", at],
      ["keptLocally", at + 9],
    ]);
  });
});
