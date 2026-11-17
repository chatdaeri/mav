import { afterEach, describe, expect, it } from "vitest";
import { reconcileReport } from "../reconcileReport";
import { READ_ONLY_DETAIL } from "../readOnlyRejections";
import {
  SELF_ACCESS_WINDOW_MS,
  isSelfAccessChange,
  markSelfAccessChange,
  resetSelfAccessChanges,
} from "../selfAccessChanges";
import { summarizeReconcile } from "../../reconcileSummary";

afterEach(() => {
  reconcileReport.clear();
  resetSelfAccessChanges();
});

describe("reconcileReport.forgetReadable", () => {
  it("drops lost-access and teammate-delete lines for docs listed again", () => {
    reconcileReport.record({ kind: "keptLocally", docId: "a", path: "A.md", detail: ".context/trash/s/A.md" });
    reconcileReport.record({ kind: "deletedByTeammate", docId: "b", path: "B.md", detail: ".context/trash/s/B.md" });
    reconcileReport.record({ kind: "selfRevoked", docId: "c", path: "C.md", detail: ".context/trash/s/C.md" });
    reconcileReport.record({ kind: "keptLocally", docId: "d", path: "D.md", detail: ".context/trash/s/D.md" });
    expect(reconcileReport.forgetReadable(new Set(["a", "b", "c"]))).toBe(3);
    expect(reconcileReport.items().map((it) => it.docId)).toEqual(["d"]);
  });

  it("keeps read-only refusals, other kinds and seeded items", () => {
    reconcileReport.record({ kind: "keptLocally", docId: "a", path: "A.md", detail: READ_ONLY_DETAIL });
    reconcileReport.record({ kind: "restoredFromServer", docId: "a", path: "A.md" });
    reconcileReport.record({ kind: "keptLocally", docId: "a", path: "A.md", detail: "x" }, { seeded: true });
    expect(reconcileReport.forgetReadable(new Set(["a"]))).toBe(0);
    expect(reconcileReport.items()).toHaveLength(3);
  });

  it("keeps the drain cursor on the right item after a removal", () => {
    reconcileReport.record({ kind: "keptLocally", docId: "a", path: "A.md", detail: "x" });
    reconcileReport.record({ kind: "restoredFromServer", docId: "r", path: "R.md" });
    expect(reconcileReport.drain()).toHaveLength(2);
    reconcileReport.forgetReadable(new Set(["a"]));
    reconcileReport.record({ kind: "folderKept", path: "F" });
    expect(reconcileReport.drain().map((it) => it.kind)).toEqual(["folderKept"]);
  });

  it("notifies listeners so the banner shrinks", () => {
    const seen: number[] = [];
    reconcileReport.record({ kind: "keptLocally", docId: "a", path: "A.md", detail: "x" });
    const off = reconcileReport.subscribe((items) => seen.push(items.length));
    reconcileReport.forgetReadable(new Set(["a"]));
    off();
    expect(seen).toEqual([0]);
  });
});

describe("selfAccessChanges", () => {
  it("matches a marked id inside the window only", () => {
    markSelfAccessChange(["org-1"], 1_000);
    expect(isSelfAccessChange(["doc", null, "org-1"], 1_000 + SELF_ACCESS_WINDOW_MS)).toBe(true);
    expect(isSelfAccessChange(["doc", "org-1"], 1_001 + SELF_ACCESS_WINDOW_MS)).toBe(false);
    expect(isSelfAccessChange(["other"], 1_000)).toBe(false);
  });
});

describe("selfRevoked summary", () => {
  it("reads as a quiet note, not a loss", () => {
    const one = summarizeReconcile([{ kind: "selfRevoked", docId: "a", path: "A.md", at: 1 }]);
    expect(one).toEqual([
      { kind: "selfRevoked", count: 1, text: "노트 1개에 대한 내 접근 권한을 직접 제거했어요. 사본은 이 기기에 남아 있어요." },
    ]);
    const two = summarizeReconcile([
      { kind: "selfRevoked", docId: "a", path: "A.md", at: 1 },
      { kind: "selfRevoked", docId: "b", path: "B.md", at: 1 },
    ]);
    expect(two[0].text).toBe("노트 2개에 대한 내 접근 권한을 직접 제거했어요. 사본은 이 기기에 남아 있어요.");
  });
});
