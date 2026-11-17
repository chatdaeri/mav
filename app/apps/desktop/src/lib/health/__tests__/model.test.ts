// The Health report is a promise to the user: the word at the top of the page is
// what they will trust when they close the laptop. Every test here is a way that
// promise could have been made falsely — a vault reported healthy while notes
// were stranded, a permanent failure offered a pointless Retry, a bulk run
// mistaken for an offline one, a stage lighting up somewhere other than where the
// problem actually is.

import { describe, expect, it } from "vitest";
import { syncBadgeLabel } from "../../../components/Identity";
import {
  buildHealthReport,
  classifyUploadReason,
  isLimitCode,
  MAX_UNREGISTERED_ISSUES,
  num,
  ownerOf,
} from "../model";
import type { HealthInput } from "../model";
import type { VaultStats } from "../types";

const NOW = 1_700_000_000_000;

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    syncEnabled: true,
    syncStatus: "synced",
    authStatus: "signed-in",
    hasSession: true,
    openFolderIsSynced: true,
    syncProgress: null,
    lastSyncedAt: NOW - 120_000,
    serverUrl: "https://api.baalda.com",
    now: NOW,
    docIdByPath: {},
    docSyncState: {},
    localNotePaths: [],
    failures: { registry: [], content: [], limitCode: null },
    stats: null,
    ...over,
  };
}

/** A census with plausible defaults; override only the field under test. */
function statsWith(over: Partial<VaultStats> = {}): VaultStats {
  return {
    computedAt: NOW,
    notes: { count: 10, bytes: 50_000, empty: 0 },
    folders: 2,
    attachments: { count: 0, bytes: 0 },
    otherFiles: { count: 0, bytes: 0 },
    tags: 4,
    links: 9,
    brokenLinks: 0,
    index: { bytes: 100_000, files: 0, extractedTextBytes: 0 },
    history: { docs: 10, updates: 100, bytes: 200_000, orphanDocs: 0, orphanBytes: 0 },
    largestNotes: [],
    largestFiles: [],
    heaviestHistory: [],
    activity: { modifiedLast7d: 1, modifiedLast30d: 2, weeks: [], days: [] },
    ...over,
  };
}

/** A vault where every note is mapped and confirmed. */
function healthyVault(n: number): Partial<HealthInput> {
  const docIdByPath: Record<string, string> = {};
  const docSyncState: Record<string, "synced"> = {};
  const localNotePaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = `Notes/note-${String(i).padStart(3, "0")}.md`;
    docIdByPath[p] = `doc-${i}`;
    docSyncState[`doc-${i}`] = "synced";
    localNotePaths.push(p);
  }
  return { docIdByPath, docSyncState, localNotePaths };
}

function stage(report: ReturnType<typeof buildHealthReport>, id: string) {
  const s = report.stages.find((x) => x.id === id);
  if (!s) throw new Error(`no ${id} stage`);
  return s;
}

describe("verdict precedence", () => {
  it("reports `local` and no counts when sync is off, whatever else is true", () => {
    // Sync off outranks everything: a local folder has no server to be behind.
    const r = buildHealthReport(
      input({
        syncEnabled: false,
        syncStatus: "no-access",
        authStatus: "signed-out",
        hasSession: false,
        ...healthyVault(3),
      }),
    );
    expect(r.verdict).toBe("local");
    expect(r.counts).toBeNull();
    expect(r.serverHost).toBeNull();
    expect(stage(r, "connection").state).toBe("off");
    expect(stage(r, "server").state).toBe("off");
    expect(r.headline).toBe("이 폴더는 동기화가 꺼져 있어요");
  });

  it("reports `signed-out` on a synced folder, ahead of the socket's own status", () => {
    // `mintFailureStatus` maps a 401 to a quiet "offline", so a signed-out app is
    // indistinguishable from a working offline one by socket status alone. The
    // auth fact is the real one (mirrors `notSyncingReason`).
    const r = buildHealthReport(
      input({ authStatus: "signed-out", hasSession: false, syncStatus: "offline" }),
    );
    expect(r.verdict).toBe("signed-out");
    expect(stage(r, "connection").state).toBe("error");
    expect(stage(r, "connection").headline).toBe("로그아웃됨");
  });

  it("stays silent while auth is still loading, and on a folder that was never synced", () => {
    // The window between paint and session restore must not flash "Signed out".
    expect(
      buildHealthReport(input({ authStatus: "unknown", hasSession: false })).verdict,
    ).not.toBe("signed-out");
    // A folder with no `.context` stamp has nothing to warn about.
    expect(
      buildHealthReport(
        input({ openFolderIsSynced: false, authStatus: "signed-out", hasSession: false }),
      ).verdict,
    ).not.toBe("signed-out");
  });

  it("reports `no-access` ahead of offline/connecting, and names it as an issue", () => {
    const r = buildHealthReport(input({ syncStatus: "no-access", ...healthyVault(2) }));
    expect(r.verdict).toBe("no-access");
    const issue = r.issues.find((i) => i.kind === "no-access");
    expect(issue).toBeDefined();
    expect(issue?.docId).toBeNull();
    expect(issue?.path).toBeNull();
    expect(issue?.remedies).toEqual(["contact-owner", "copy-details"]);
    expect(stage(r, "connection").state).toBe("error");
  });

  it("reports `offline` and `connecting` from the socket status", () => {
    expect(buildHealthReport(input({ syncStatus: "offline" })).verdict).toBe("offline");
    expect(buildHealthReport(input({ syncStatus: "connecting" })).verdict).toBe(
      "connecting",
    );
  });

  it("reports `syncing` while a bulk phase runs, even though the socket says offline", () => {
    // `syncStatus` belongs to the OPEN doc, and no note is open during a launch
    // backfill — so it sits at "offline" for the whole run. Work that is
    // demonstrably moving is not offline.
    const r = buildHealthReport(
      input({
        syncStatus: "offline",
        syncProgress: { phase: "uploading", done: 40, total: 100, failed: 0 },
        ...healthyVault(100),
      }),
    );
    expect(r.verdict).toBe("syncing");
    expect(r.headline).toBe("동기화 중: 100개 중 40개 업데이트");
    expect(stage(r, "server").state).toBe("busy");
  });

  it("names notes whose content never reached the server while an upload resumes (#258)", () => {
    const r = buildHealthReport(
      input({
        syncStatus: "offline",
        syncProgress: { phase: "uploading", done: 40, total: 100, failed: 0, notUploaded: 60 },
        ...healthyVault(100),
      }),
    );
    expect(r.verdict).toBe("syncing");
    expect(r.headline).toBe("업로드 중: 노트 60개가 아직 업로드되지 않았어요");
  });

  it("reports `attention` for any error-severity issue", () => {
    const r = buildHealthReport(
      input({
        ...healthyVault(3),
        failures: {
          registry: [],
          content: [{ docId: "doc-1", relPath: "Notes/note-001.md", reason: "socket reset" }],
          limitCode: null,
        },
      }),
    );
    expect(r.verdict).toBe("attention");
  });

  it("reports `attention` for a failed count or a failed progress phase, with no issue list", () => {
    const v = healthyVault(3);
    (v.docSyncState as Record<string, string>)["doc-2"] = "error";
    expect(buildHealthReport(input(v)).verdict).toBe("attention");

    expect(
      buildHealthReport(
        input({
          ...healthyVault(3),
          syncProgress: { phase: "error", done: 3, total: 3, failed: 1 },
        }),
      ).verdict,
    ).toBe("attention");
  });

  it("reports `healthy` only when every note is confirmed", () => {
    const r = buildHealthReport(input(healthyVault(1204)));
    expect(r.verdict).toBe("healthy");
    expect(r.headline).toBe("노트 1,204개 모두 원격 볼트에 있어요");
    expect(r.detail).toContain("api.baalda.com");
    expect(r.detail).toContain("2분 전");
    expect(r.counts).toEqual({
      total: 1204,
      synced: 1204,
      pending: 0,
      failed: 0,
      unsynced: 0,
      unreported: 0,
    });
    expect(r.serverHost).toBe("api.baalda.com");
    for (const s of r.stages) expect(s.state).not.toBe("error");
  });

  it("does not call an empty vault 'all 0 notes synced'", () => {
    const r = buildHealthReport(input());
    expect(r.verdict).toBe("healthy");
    expect(r.headline).toBe("이 볼트는 비어 있어요");
  });

  it("counts an unmapped note as unsynced, so a stranded note cannot read healthy", () => {
    // The honesty rule from `syncRollup.ts`, end to end.
    const r = buildHealthReport(
      input({ ...healthyVault(2), localNotePaths: ["Notes/note-000.md", "Loose.md"] }),
    );
    expect(r.counts?.total).toBe(3);
    expect(r.counts?.synced).toBe(2);
    expect(r.verdict).toBe("attention");
    expect(r.headline).toBe("노트 1개가 원격 볼트에 없어요");
  });
});

describe("content failures", () => {
  const tooLargeFile = {
    docId: "doc-big",
    relPath: "Big.md",
    reason: "too large to sync (12.4 MB; the limit is 10 MB)",
    permanent: true,
    kind: "too-large" as const,
  };
  const tooLargeHistory = {
    docId: "doc-hist",
    relPath: "Hist.md",
    reason:
      "too large to sync (17.2 MB of edit history; the limit is 10 MB). " +
      "Reset this note's history to sync it again",
    permanent: true,
    kind: "too-large" as const,
  };

  it("maps a typed size failure to `too-large`, never offering a Retry that cannot work", () => {
    const r = buildHealthReport(
      input({ failures: { registry: [], content: [tooLargeFile], limitCode: null } }),
    );
    const i = r.issues[0];
    expect(i.kind).toBe("too-large");
    expect(i.severity).toBe("error");
    expect(i.remedies).toEqual([
      "open",
      "reveal",
      "export-copy",
      "reset-history",
      "delete",
      "copy-details",
    ]);
    expect(i.remedies).not.toContain("retry");
    // The size and the cap, in the user's terms rather than the engineer's.
    expect(i.why).toContain("12.4 MB");
    expect(i.why).toContain("10MB");
  });

  it("tells the two too-large shapes apart: the FILE versus the edit HISTORY", () => {
    const r = buildHealthReport(
      input({ failures: { registry: [], content: [tooLargeHistory], limitCode: null } }),
    );
    expect(r.issues[0].why).toContain("편집 기록이 17.2 MB");
    expect(r.issues[0].why).toContain("노트 본문은 문제가 아니에요");
    // History is the cause, so the fix that clears history leads.
    expect(r.issues[0].remedies[0]).toBe("reset-history");
    expect(r.issues[0].explanation.fixes[0]).toContain("이 노트의 기록을 초기화하세요");
  });

  it("does not guess that an untyped permanent failure is too large", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [],
          content: [{ docId: "d", relPath: "X.md", reason: "the server said no", permanent: true }],
          limitCode: null,
        },
      }),
    );
    expect(r.issues[0].kind).toBe("upload-failed");
    expect(r.issues[0].why).toContain("The server said no");
  });

  it("reports a refused local edit as an access problem, not a size problem", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [],
          content: [
            {
              docId: "d-readonly",
              relPath: "Small.md",
              reason:
                "edit could not be sent: no write access; copy saved to .context/trash/t/Small.md",
              permanent: true,
              kind: "no-write-access",
            },
          ],
          limitCode: null,
        },
      }),
    );
    expect(r.issues[0].kind).toBe("no-write-access");
    expect(r.issues[0].title).toBe("읽기 전용 동기화 확인 필요");
    expect(r.issues[0].remedies).toContain("retry");
    expect(r.issues[0].why).toContain("복구용 사본");
  });

  it("maps a transient failure to `upload-failed`, with a Retry", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [],
          content: [{ docId: "d1", relPath: "A.md", reason: "socket closed" }],
          limitCode: null,
        },
      }),
    );
    const i = r.issues[0];
    expect(i.kind).toBe("upload-failed");
    expect(i.remedies).toEqual(["retry", "open", "reveal", "export-copy", "copy-details"]);
    expect(i.why).toContain("Socket closed.");
    expect(i.why).toContain("유일한 사본은 이 기기에 있어요");
  });
});

describe("registry failures", () => {
  it("recognises the plan-limit codes and only those", () => {
    expect(isLimitCode("vault_limit_reached")).toBe(true);
    expect(isLimitCode("member_limit_reached")).toBe(true);
    expect(isLimitCode("root_frozen")).toBe(false);
    expect(isLimitCode(null)).toBe(false);
  });

  it("maps a limit code to `limit` with the upgrade remedy, not a pointless Retry", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [
            {
              kind: "note",
              path: "New.md",
              docId: "d9",
              reason: "402",
              code: "vault_limit_reached",
            },
          ],
          content: [],
          limitCode: "vault_limit_reached",
        },
      }),
    );
    const i = r.issues.find((x) => x.kind === "limit");
    expect(i?.remedies).toEqual(["upgrade", "copy-details"]);
    expect(i?.code).toBe("vault_limit_reached");
    // One limit conversation, not two: the vault-level fallback must not double up.
    expect(r.issues.filter((x) => x.kind === "limit")).toHaveLength(1);
  });

  it("still says the limit once when no individual row carried the code", () => {
    const r = buildHealthReport(
      input({ failures: { registry: [], content: [], limitCode: "member_limit_reached" } }),
    );
    const i = r.issues.find((x) => x.kind === "limit");
    expect(i).toBeDefined();
    expect(i?.path).toBeNull();
    expect(i?.remedies).toEqual(["upgrade", "copy-details"]);
  });

  it("reports refused inbound removals as safety checks without claiming a downloaded copy", () => {
    const r = buildHealthReport(input({ failures: {
      registry: [{ kind: "inbound-blocked", path: "Campaigns", docId: null,
        reason: "refused: 1743 folder access removals exceeds the safety limit", code: null }],
      content: [], limitCode: null,
    } }));
    const issue = r.issues.find((i) => i.path === "Campaigns")!;
    expect(issue.kind).toBe("inbound-blocked");
    expect(issue.title).toBe("안전을 위해 로컬 변경을 보류했어요");
    expect(issue.explanation.safety).toBe("unknown");
    expect(issue.why).not.toContain("could not be written");
  });

  // #216: symbolic links.
  it("says a linked path was refused in plain words", () => {
    const r = buildHealthReport(input({ failures: {
      registry: [{ kind: "inbound-blocked", path: "Old/n.md", docId: "old-id",
        reason: "This path is a symbolic link. 마이 세컨드 브레인 does not sync through links.", code: "symlink" }],
      content: [], limitCode: null,
    } }));
    const issue = r.issues.find((i) => i.path === "Old/n.md")!;
    expect(issue.kind).toBe("inbound-blocked");
    expect(issue.title).toBe("연결된 경로가 동기화되지 않았어요");
    expect(issue.why).toBe("This path is a symbolic link. 마이 세컨드 브레인 does not sync through links.");
    expect(issue.code).toBe("symlink");
  });

  // #221: a live bulk delete held for the user's answer.
  it("lists a note held by a bulk delete as being restored, not failed", () => {
    const r = buildHealthReport(input({ failures: {
      registry: [{ kind: "inbound-blocked", path: "Team/x.md", docId: "x-id",
        reason: "removed from this folder in a bulk delete", code: "delete_decision" }],
      content: [], limitCode: null,
    } }));
    const issue = r.issues.find((i) => i.path === "Team/x.md")!;
    expect(issue.kind).toBe("inbound-blocked");
    expect(issue.severity).toBe("warn");
    expect(issue.title).toBe("디스크에서 삭제돼 복원 중이에요");
    expect(JSON.stringify(issue.explanation)).not.toContain("Delete for everyone");
    expect(issue.remedies).not.toContain("retry");
    expect(issue.code).toBe("delete_decision");
  });

  it("warns about linked paths and flags two notes sharing one file as an error", () => {
    const r = buildHealthReport(input({
      checks: {
        computedAt: NOW,
        results: [],
        linkedPaths: {
          id: "linked-paths",
          count: 2,
          items: [
            { path: "Alias.md", detail: "links to /v/Solo.md" },
            { path: "Old", detail: "links to /v/Business/Old" },
          ],
        },
        sharedFiles: [{ paths: ["Business/Old/n.md", "Old/n.md"], docIds: ["new-id", "old-id"] }],
      },
    }));
    const linked = r.issues.find((i) => i.kind === "linked-paths")!;
    expect(linked.severity).toBe("warn");
    expect(linked.title).toBe("연결된 경로 2개가 동기화에서 제외됐어요");
    expect(linked.facts.map((f) => f.value)).toContain("Old (links to /v/Business/Old)");
    const shared = r.issues.find((i) => i.kind === "shared-file")!;
    expect(shared.severity).toBe("error");
    expect(shared.title).toBe("노트 두 개가 디스크의 한 파일을 공유해요");
    expect(shared.why).toContain("Business/Old/n.md, Old/n.md");
    expect(r.verdict).toBe("attention");
    // Nothing to say for a vault without links.
    const clean = buildHealthReport(input({
      checks: { computedAt: NOW, results: [], linkedPaths: { id: "linked-paths", count: 0, items: [] }, sharedFiles: [] },
    }));
    expect(clean.issues.filter((i) => i.kind === "linked-paths" || i.kind === "shared-file")).toEqual([]);
  });

  it("maps note/folder failures to `register-failed` and materialize/inbound to `materialize-failed`", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [
            { kind: "note", path: "a/N.md", docId: "d1", reason: "500", code: null },
            { kind: "folder", path: "a", docId: null, reason: "500", code: null },
            { kind: "materialize", path: "b/M.md", docId: "d2", reason: "EACCES", code: null },
            { kind: "inbound", path: "c/I.md", docId: "d3", reason: "EACCES", code: null },
          ],
          content: [],
          limitCode: null,
        },
      }),
    );
    const byPath = new Map(r.issues.map((i) => [i.path, i]));
    expect(byPath.get("a/N.md")?.kind).toBe("register-failed");
    expect(byPath.get("a/N.md")?.remedies).toEqual([
      "retry",
      "open",
      "reveal",
      "copy-details",
    ]);
    expect(byPath.get("a")?.kind).toBe("register-failed");
    // A folder has nothing to open in the editor.
    expect(byPath.get("a")?.remedies).toEqual(["retry", "reveal", "copy-details"]);
    expect(byPath.get("b/M.md")?.kind).toBe("materialize-failed");
    expect(byPath.get("c/I.md")?.kind).toBe("materialize-failed");
    expect(byPath.get("b/M.md")?.remedies).toEqual(["retry", "reveal", "copy-details"]);
  });

  it("surfaces an `orphan` as a file kept on disk whose only copy may be here", () => {
    // `registry.ts` leaves these deliberately: the server deleted or revoked the
    // row, and this device never confirmed the content upstream. The user has to
    // look at it, so the remedies open and reveal it before offering a delete.
    const r = buildHealthReport(
      input({
        failures: {
          registry: [
            {
              kind: "orphan",
              path: "Gone.md",
              docId: "d7",
              reason:
                "deleted on the server, but this device never confirmed its content, so it was left on disk",
              code: null,
            },
          ],
          content: [],
          limitCode: null,
        },
      }),
    );
    const i = r.issues[0];
    expect(i.kind).toBe("left-behind");
    expect(i.severity).toBe("error");
    expect(i.remedies).toEqual([
      "open",
      "reveal",
      "reregister",
      "export-copy",
      "delete",
      "copy-details",
    ]);
    expect(i.why).toContain("유일한 사본이 있을 수 있어서");
  });
});

describe("unregistered notes", () => {
  const unmapped = (n: number): Partial<HealthInput> => ({
    docIdByPath: {},
    docSyncState: {},
    localNotePaths: Array.from({ length: n }, (_, i) => `U/${String(i).padStart(4, "0")}.md`),
  });

  it("is suppressed while a bulk phase runs — then every note is merely in flight", () => {
    const r = buildHealthReport(
      input({
        ...unmapped(5),
        syncProgress: { phase: "registering", done: 0, total: 5, failed: 0 },
      }),
    );
    expect(r.issues.filter((i) => i.kind === "unregistered")).toHaveLength(0);
    expect(r.verdict).toBe("syncing");
  });

  it("warns once the run has settled", () => {
    const r = buildHealthReport(
      input({ ...unmapped(2), syncProgress: { phase: "done", done: 2, total: 2, failed: 0 } }),
    );
    const warns = r.issues.filter((i) => i.kind === "unregistered");
    expect(warns).toHaveLength(2);
    expect(warns[0].severity).toBe("warn");
    expect(warns[0].docId).toBeNull();
  });

  it("never blames a note that already has a failure recorded against it", () => {
    const r = buildHealthReport(
      input({
        ...unmapped(2),
        failures: {
          registry: [{ kind: "note", path: "U/0000.md", docId: null, reason: "500", code: null }],
          content: [],
          limitCode: null,
        },
      }),
    );
    expect(r.issues.filter((i) => i.path === "U/0000.md")).toHaveLength(1);
    expect(r.issues.find((i) => i.path === "U/0000.md")?.kind).toBe("register-failed");
  });

  it("caps the list and puts the true total in the report detail", () => {
    const n = MAX_UNREGISTERED_ISSUES + 137;
    const r = buildHealthReport(input(unmapped(n)));
    expect(r.issues.filter((i) => i.kind === "unregistered")).toHaveLength(
      MAX_UNREGISTERED_ISSUES,
    );
    expect(r.detail).toContain(`등록되지 않은 노트 ${num(n)}개 중 처음 50개`);
  });

  it("says nothing while the server has not answered — the reason is the connection", () => {
    for (const syncStatus of ["offline", "connecting", "error"] as const) {
      const r = buildHealthReport(
        input({
          ...unmapped(18),
          syncStatus,
          syncProgress: { phase: "done", done: 0, total: 0, failed: 0 },
        }),
      );
      expect(r.issues.filter((i) => i.kind === "unregistered")).toHaveLength(0);
    }
  });

  it("says nothing when signed out — the reason is the session, not the notes", () => {
    const r = buildHealthReport(
      input({ ...unmapped(3), authStatus: "signed-out", hasSession: false }),
    );
    expect(r.issues.filter((i) => i.kind === "unregistered")).toHaveLength(0);
  });
});

describe("stats-derived issues and stages", () => {
  function stats(over: Partial<VaultStats> = {}): VaultStats {
    return {
      computedAt: NOW,
      notes: { count: 1204, bytes: 5_000_000, empty: 3 },
      folders: 42,
      attachments: { count: 7, bytes: 900_000 },
      otherFiles: { count: 2, bytes: 1_000 },
      tags: 88,
      links: 640,
      brokenLinks: 5,
      index: { bytes: 12_000_000, files: 0, extractedTextBytes: 0 },
      history: { docs: 1204, updates: 90_000, bytes: 40_000_000, orphanDocs: 0, orphanBytes: 0 },
      largestNotes: [],
      largestFiles: [],
      heaviestHistory: [],
      activity: { modifiedLast7d: 12, modifiedLast30d: 40, weeks: [], days: [] },
      ...over,
    };
  }

  it("never raises leftover history as an issue: the history stage mentions it, still ok", () => {
    const r = buildHealthReport(
      input({
        ...healthyVault(4),
        stats: stats({
          history: {
            docs: 1204,
            updates: 90_000,
            bytes: 40_000_000,
            orphanDocs: 953,
            orphanBytes: 900_000_000,
          },
        }),
      }),
    );
    // The sync layer reclaims it on its own, so nothing offers a Reclaim.
    expect(r.issues.filter((x) => x.kind === "orphan-history")).toHaveLength(0);
    expect(r.issues.some((x) => x.remedies.some((m) => (m as string) === "reclaim"))).toBe(false);
    expect(stage(r, "history").state).toBe("ok");
    expect(stage(r, "history").detail).toContain("그중 953개는 이 볼트에 더 이상 없는 노트의 기록이에요");
    expect(r.verdict).toBe("healthy");
  });

  it("raises nothing when there are no orphans", () => {
    const r = buildHealthReport(input({ ...healthyVault(4), stats: stats() }));
    expect(r.issues.filter((x) => x.kind === "orphan-history")).toHaveLength(0);
    expect(stage(r, "history").state).toBe("ok");
  });

  it("uses the census for the disk and index headlines when it has landed", () => {
    const r = buildHealthReport(input({ ...healthyVault(4), stats: stats() }));
    expect(stage(r, "disk").headline).toBe("1,204");
    expect(stage(r, "index").headline).toBe("1,204");
    expect(stage(r, "index").detail).toContain("대상이 없는 링크 5개");
    expect(stage(r, "history").headline).toBe("1,204");
  });

  it("falls back to the roll-up's own count with no census, and never shows a fake number", () => {
    const r = buildHealthReport(input(healthyVault(7)));
    expect(stage(r, "disk").headline).toBe("7");
    expect(stage(r, "index").headline).toBe("인덱싱됨");
    expect(stage(r, "history").headline).toBe("—");
  });
});

describe("stage error placement", () => {
  it("puts the error on the connection, not the server, when the session is the problem", () => {
    // The first stage that EXPLAINS the verdict carries it; a server stage lit up
    // as well would point at two places for one cause.
    const r = buildHealthReport(
      input({ ...healthyVault(3), authStatus: "signed-out", hasSession: false }),
    );
    expect(stage(r, "connection").state).toBe("error");
    expect(stage(r, "server").state).toBe("ok");
  });

  it("puts the error on the server when the connection is fine", () => {
    const r = buildHealthReport(
      input({
        ...healthyVault(3),
        failures: {
          registry: [],
          content: [{ docId: "doc-0", relPath: "Notes/note-000.md", reason: "boom" }],
          limitCode: null,
        },
      }),
    );
    expect(stage(r, "connection").state).toBe("ok");
    expect(stage(r, "server").state).toBe("error");
  });

  it("warns — never errors — the server stage for notes nothing has spoken for yet", () => {
    // `unreported` is the honest "no transition reported this session", not work.
    const r = buildHealthReport(
      input({
        docIdByPath: { "A.md": "d1", "B.md": "d2" },
        docSyncState: { d1: "synced" },
        localNotePaths: ["A.md", "B.md"],
        syncProgress: { phase: "done", done: 2, total: 2, failed: 0 },
      }),
    );
    expect(r.counts?.unreported).toBe(1);
    expect(stage(r, "server").state).toBe("warn");
  });

  it("flags a view-only grant on the connection without calling it broken", () => {
    const r = buildHealthReport(input({ ...healthyVault(2), syncStatus: "read-only" }));
    expect(stage(r, "connection").state).toBe("warn");
    expect(stage(r, "connection").headline).toBe("보기 전용");
    expect(r.verdict).toBe("healthy");
  });
});

describe("issue ordering", () => {
  it("puts errors before warnings, vault-level before per-note, then sorts by path", () => {
    const r = buildHealthReport(
      input({
        docIdByPath: {},
        docSyncState: {},
        localNotePaths: ["zzz.md"],
        syncProgress: { phase: "done", done: 0, total: 0, failed: 0 },
        stats: {
          computedAt: NOW,
          notes: { count: 1, bytes: 1, empty: 0 },
          folders: 0,
          attachments: { count: 0, bytes: 0 },
          otherFiles: { count: 0, bytes: 0 },
          tags: 0,
          links: 0,
          brokenLinks: 0,
          index: { bytes: 0, files: 0, extractedTextBytes: 0 },
          history: { docs: 1, updates: 1, bytes: 1, orphanDocs: 4, orphanBytes: 9 },
          largestNotes: [],
          largestFiles: [],
          heaviestHistory: [],
          activity: { modifiedLast7d: 0, modifiedLast30d: 0, weeks: [], days: [] },
        },
        failures: {
          registry: [],
          content: [
            { docId: "d2", relPath: "b.md", reason: "x" },
            { docId: "d1", relPath: "a.md", reason: "x" },
          ],
          limitCode: "vault_limit_reached",
        },
      }),
    );
    expect(r.issues.map((i) => [i.severity, i.kind, i.path])).toEqual([
      ["error", "limit", null],
      ["error", "upload-failed", "a.md"],
      ["error", "upload-failed", "b.md"],
      ["warn", "unregistered", "zzz.md"],
    ]);
  });

  it("never lists the same key twice", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [{ kind: "note", path: "A.md", docId: "d1", reason: "500", code: null }],
          content: [{ docId: "d1", relPath: "A.md", reason: "boom" }],
          limitCode: null,
        },
      }),
    );
    expect(r.issues).toHaveLength(1);
    // Content wins: it names the actual note whose bytes are stuck here.
    expect(r.issues[0].kind).toBe("upload-failed");
  });
});

describe("formatting helpers", () => {
  it("groups thousands without Intl", () => {
    expect(num(0)).toBe("0");
    expect(num(999)).toBe("999");
    expect(num(1204)).toBe("1,204");
    expect(num(1_234_567)).toBe("1,234,567");
  });

  it("words elapsed time through `format.ts`, so the card and the tables agree", () => {
    // One wording, one module. `format.relativeTime` has its own unit tests; this
    // only pins that the report reaches for it rather than rolling its own.
    const r = buildHealthReport(input({ lastSyncedAt: NOW - 3 * 86_400_000 }));
    expect(r.detail).toContain("3일 전");
    expect(buildHealthReport(input({ lastSyncedAt: NOW })).detail).toContain("방금 전");
  });

  it("degrades to no host rather than inventing one", () => {
    const r = buildHealthReport(input({ serverUrl: "not a url", ...healthyVault(1) }));
    expect(r.serverHost).toBeNull();
    expect(r.detail).not.toContain("·");
  });
});

// ── Reasoning ─────────────────────────────────────────────────────────────────
//
// The page's whole point: a note that did not sync has to say WHY, in words
// someone who does not know what a CRDT is can act on. Every kind gets the same
// four promises — what this means, what 마브 does next, what you can do, where
// your content is — and the last one is a safety claim, so these tests are the
// guard against the page ever saying "safe on the server" about a note nothing
// confirmed.

describe("explanations", () => {
  const issueOf = (over: Partial<HealthInput>, kind: string) => {
    const r = buildHealthReport(input(over));
    const i = r.issues.find((x) => x.kind === kind);
    if (!i) throw new Error(`no ${kind} issue`);
    return i;
  };

  /** Every issue, whatever its kind, keeps the four promises. */
  function expectWellFormed(i: ReturnType<typeof issueOf>): void {
    expect(i.explanation.meaning.length).toBeGreaterThan(20);
    expect(i.explanation.next.length).toBeGreaterThan(5);
    expect(i.explanation.fixes.length).toBeGreaterThan(0);
    for (const f of i.explanation.fixes) expect(f.trim()).not.toBe("");
    expect(["only-here", "on-server", "both", "unknown"]).toContain(i.explanation.safety);
    expect(Array.isArray(i.facts)).toBe(true);
    expect(typeof i.autoRetries).toBe("boolean");
  }

  it("gives every kind an explanation, facts and an honest auto-retry flag", () => {
    const r = buildHealthReport(
      input({
        syncStatus: "no-access",
        failures: {
          registry: [
            { kind: "note", path: "a/N.md", docId: "d1", reason: "500", code: null },
            { kind: "materialize", path: "b/M.md", docId: "d2", reason: "EACCES", code: null },
            { kind: "orphan", path: "Gone.md", docId: "d7", reason: "revoked", code: null },
            { kind: "note", path: "c/L.md", docId: "d8", reason: "402", code: "vault_limit_reached" },
          ],
          content: [
            { docId: "d3", relPath: "Big.md", reason: "too large to sync (12.4 MB; the limit is 10 MB)", permanent: true },
            { docId: "d4", relPath: "A.md", reason: "socket closed" },
          ],
          limitCode: null,
        },
        stats: statsWith({ history: { docs: 3, updates: 9, bytes: 900, orphanDocs: 2, orphanBytes: 400 } }),
      }),
    );
    const kinds = new Set(r.issues.map((i) => i.kind));
    for (const want of [
      "too-large",
      "upload-failed",
      "register-failed",
      "materialize-failed",
      "left-behind",
      "limit",
      "no-access",
    ]) {
      expect(kinds).toContain(want);
    }
    for (const i of r.issues) expectWellFormed(i);
  });

  it("only promises a copy on the server where one is confirmed to be", () => {
    // `materialize-failed` is the ONE kind whose content genuinely is upstream:
    // the server has it and the write to disk is what failed. Everything else
    // that names a note must say the copy is here only, or say it doesn't know.
    const mat = issueOf(
      {
        failures: {
          registry: [{ kind: "materialize", path: "b/M.md", docId: "d2", reason: "EACCES", code: null }],
          content: [],
          limitCode: null,
        },
      },
      "materialize-failed",
    );
    expect(mat.explanation.safety).toBe("on-server");

    const up = issueOf(
      {
        failures: {
          registry: [],
          content: [{ docId: "d1", relPath: "A.md", reason: "socket closed" }],
          limitCode: null,
        },
        },
      "upload-failed",
    );
    expect(up.explanation.safety).toBe("only-here");

    // Refused access means we cannot ask the server anything, so neither claim
    // would be honest.
    const na = issueOf({ syncStatus: "no-access" }, "no-access");
    expect(na.explanation.safety).toBe("unknown");
  });

  it("flags auto-retry only where the sync layer really does try again", () => {
    const permanent = issueOf(
      {
        failures: {
          registry: [],
          content: [
            { docId: "d", relPath: "Big.md", reason: "too large to sync (12.4 MB; the limit is 10 MB)", permanent: true },
          ],
          limitCode: null,
        },
      },
      "too-large",
    );
    expect(permanent.autoRetries).toBe(false);
    expect(permanent.explanation.next).toContain("할 일 없음");

    const transient = issueOf(
      {
        failures: {
          registry: [],
          content: [{ docId: "d", relPath: "A.md", reason: "socket closed" }],
          limitCode: null,
        },
      },
      "upload-failed",
    );
    expect(transient.autoRetries).toBe(true);

    const limit = issueOf(
      { failures: { registry: [], content: [], limitCode: "member_limit_reached" } },
      "limit",
    );
    expect(limit.autoRetries).toBe(false);

    const leftBehind = issueOf(
      {
        failures: {
          registry: [{ kind: "orphan", path: "Gone.md", docId: "d7", reason: "revoked", code: null }],
          content: [],
          limitCode: null,
        },
      },
      "left-behind",
    );
    expect(leftBehind.autoRetries).toBe(false);

    const unregistered = issueOf(
      { localNotePaths: ["New.md"], docIdByPath: {} },
      "unregistered",
    );
    expect(unregistered.autoRetries).toBe(true);
    expect(unregistered.explanation.next).toContain("다음 동기화");
  });

  it("carries the copyable facts a bug report needs", () => {
    const i = issueOf(
      {
        failures: {
          registry: [],
          content: [
            {
              docId: "doc-9",
              relPath: "Notes/Big.md",
              reason: "too large to sync (12.4 MB; the limit is 10 MB)",
              permanent: true,
            },
          ],
          limitCode: null,
        },
      },
      "too-large",
    );
    const labels = i.facts.map((f) => f.label);
    expect(labels).toContain("경로");
    expect(labels).toContain("크기");
    expect(labels).toContain("한도");
    expect(labels).toContain("문서 ID");
    expect(labels).toContain("원본 사유");
    // Ids and raw error text are the two things people paste into an issue.
    expect(i.facts.find((f) => f.label === "문서 ID")?.copyable).toBe(true);
    expect(i.facts.find((f) => f.label === "원본 사유")?.copyable).toBe(true);
    expect(i.facts.find((f) => f.label === "한도")?.value).toBe("노트당 10MB");
  });
});

describe("too-large: file versus history", () => {
  /** A census where the FILE is small but the stored history is enormous. */
  const historyIsTheProblem = statsWith({
    largestNotes: [{ path: "Small.md", bytes: 2_000, mtime: NOW }],
    heaviestHistory: [{ docId: "d1", path: "Small.md", updates: 900, bytes: 30 * 1024 * 1024 }],
  });

  it("blames the history when the file is under the cap and the history is over it", () => {
    // The uploader's own reason here is the FILE shape — this is the case only
    // the census can settle, and getting it wrong sends someone to shorten a
    // 2 KB note.
    const r = buildHealthReport(
      input({
        stats: historyIsTheProblem,
        failures: {
          registry: [],
          content: [
            {
              docId: "d1",
              relPath: "Small.md",
              reason: "too large to sync (30.0 MB; the limit is 10 MB)",
              permanent: true,
            },
          ],
          limitCode: null,
        },
      }),
    );
    const i = r.issues[0];
    expect(i.why).toContain("편집 기록");
    expect(i.remedies[0]).toBe("reset-history");
    expect(i.explanation.fixes[0]).toContain("이 노트의 기록을 초기화하세요");
    expect(i.facts.find((f) => f.label === "기록 크기")?.value).toBe("30.0 MB");
  });

  it("blames the file when the file itself is over the cap", () => {
    const r = buildHealthReport(
      input({
        stats: statsWith({
          largestNotes: [{ path: "Huge.md", bytes: 12 * 1024 * 1024, mtime: NOW }],
        }),
        failures: {
          registry: [],
          content: [
            {
              docId: "d2",
              relPath: "Huge.md",
              reason: "too large to sync (12.4 MB; the limit is 10 MB)",
              permanent: true,
            },
          ],
          limitCode: null,
        },
      }),
    );
    const i = r.issues[0];
    expect(i.why).toContain("12.4 MB");
    expect(i.remedies[0]).toBe("open");
    expect(i.explanation.fixes[0]).toContain("첨부 파일");
    expect(i.explanation.fixes.join(" ")).toContain("여러 개의 작은 노트로 나누세요");
  });

  it("never promotes the file to the cause just because the census didn't measure it", () => {
    // A note missing from the top-10 list is UNMEASURED, not small. The
    // uploader's own word stands.
    const r = buildHealthReport(
      input({
        stats: statsWith({ largestNotes: [], heaviestHistory: [] }),
        failures: {
          registry: [],
          content: [
            {
              docId: "d3",
              relPath: "Hist.md",
              reason: "too large to sync (17.2 MB of edit history; the limit is 10 MB)",
              permanent: true,
            },
          ],
          limitCode: null,
        },
      }),
    );
    expect(r.issues[0].why).toContain("편집 기록");
    expect(r.issues[0].remedies[0]).toBe("reset-history");
  });
});

describe("naming the owner", () => {
  const owner = { role: "owner", user: { name: "Sam", email: "sam@example.com" } };

  it("names the owner in a no-access explanation when the roster is loaded", () => {
    const r = buildHealthReport(input({ syncStatus: "no-access", members: [owner] }));
    const i = r.issues.find((x) => x.kind === "no-access");
    expect(i?.explanation.meaning).toContain("Sam (sam@example.com)");
    expect(i?.facts.find((f) => f.label === "소유자")?.value).toBe("Sam (sam@example.com)");
  });

  it("picks the owner out of the roster, and falls back to the email for a blank name", () => {
    expect(ownerOf([{ role: "member", user: { name: "A", email: "a@x" } }, owner])).toEqual({
      name: "Sam",
      email: "sam@example.com",
    });
    expect(ownerOf([{ role: "owner", user: { name: "  ", email: "o@x" } }])).toEqual({
      name: "o@x",
      email: "o@x",
    });
    expect(ownerOf([{ role: "owner" }])).toBeNull();
    expect(ownerOf(undefined)).toBeNull();
  });

  it("falls back to 'the vault's owner' rather than guessing", () => {
    const r = buildHealthReport(input({ syncStatus: "no-access", members: [] }));
    const i = r.issues.find((x) => x.kind === "no-access");
    expect(i?.explanation.meaning).toContain("볼트 소유자");
  });

  it("offers Contact owner on a view-only registration refusal, and only there", () => {
    const r = buildHealthReport(
      input({
        members: [owner],
        failures: {
          registry: [
            { kind: "note", path: "Team/N.md", docId: null, reason: "403", code: "no_write_access" },
            { kind: "note", path: "Other/N.md", docId: null, reason: "500", code: null },
          ],
          content: [],
          limitCode: null,
        },
      }),
    );
    const byPath = new Map(r.issues.map((i) => [i.path, i]));
    // Grouped by folder (see `createRefusalIssue`).
    expect(byPath.get("Team")?.remedies).toContain("contact-owner");
    expect(byPath.get("Team")?.explanation.meaning).toContain("추가할 수는 없어서");
    expect(byPath.get("Team")?.explanation.fixes[0]).toContain("Sam");
    expect(byPath.get("Other/N.md")?.remedies).not.toContain("contact-owner");
  });

  it("explains each registration code in its own words", () => {
    const codes: Record<string, string> = {
      root_frozen: "최상위는 잠겨 있어서",
      path_folder_mismatch: "서로 달라요",
      doc_id_conflict: "다른 볼트에서 이미 쓰이고 있어서",
    };
    for (const [code, phrase] of Object.entries(codes)) {
      const r = buildHealthReport(
        input({
          failures: {
            registry: [{ kind: "note", path: "N.md", docId: null, reason: "refused", code }],
            content: [],
            limitCode: null,
          },
        }),
      );
      expect(r.issues[0].code).toBe(code);
      expect(r.issues[0].explanation.meaning).toContain(phrase);
    }
  });
});

describe("classifyUploadReason", () => {
  it("turns the sync layer's own strings into a cause a person can read", () => {
    expect(classifyUploadReason("open failed: ENOENT")).toContain("열지 못해서");
    expect(classifyUploadReason("server did not respond to the initial sync")).toContain(
      "보내오지 않았어요",
    );
    expect(classifyUploadReason("server did not acknowledge the content")).toContain(
      "확인을 보내오지 않았어요",
    );
    // `syncManager.ts` rejects with the terminal status as the message.
    expect(classifyUploadReason("no-access")).toContain("보기 전용");
    expect(classifyUploadReason("deleted")).toContain("이 노트의 기록이 더 이상 없어요");
    expect(classifyUploadReason("error")).toContain("연결");
    expect(classifyUploadReason("Failed to fetch")).toContain("원격 볼트에 연결하지 못해서");
    expect(classifyUploadReason("HTTP 503")).toContain("자체 오류");
  });

  it("returns null rather than inventing a cause it doesn't know", () => {
    expect(classifyUploadReason("wibble")).toBeNull();
  });

  it("quotes the raw reason when it cannot classify it", () => {
    const r = buildHealthReport(
      input({
        failures: {
          registry: [],
          content: [{ docId: "d", relPath: "A.md", reason: "wibble" }],
          limitCode: null,
        },
      }),
    );
    expect(r.issues[0].explanation.meaning).toContain("Wibble.");
  });
});


describe("Health and header agreement during regrant", () => {
  it.each(["registering", "uploading", "downloading", "removing"] as const)(
    "keeps %s active even when all note confirmations still say synced", (phase) => {
      const progress = { phase, done: 6476, total: 6628, failed: 0 };
      const report = buildHealthReport(input({ ...healthyVault(6974), syncProgress: progress }));
      expect(report.verdict).toBe("syncing");
      const badge = syncBadgeLabel({ status: "synced", now: NOW, progress });
      expect(badge).toContain(phase === "removing" ? "권한 업데이트" : "동기화 중");
      expect(report.headline).toContain(phase === "removing" ? "권한 업데이트" : "동기화 중");
      const settled = buildHealthReport(input({ ...healthyVault(6974),
        syncProgress: { ...progress, phase: "done", done: 6628 } }));
      expect(settled.verdict).toBe("healthy");
    },
  );
});

describe("sync paused by the shrink burst brake (#252)", () => {
  it("is ONE warn issue, never a failure per held note", () => {
    const r = buildHealthReport(
      input({
        syncPause: { until: NOW + 20 * 60_000, count: 12 },
        failures: {
          registry: [],
          content: [
            { docId: "a", relPath: "a.md", reason: "Sync paused", kind: "shrink-held" },
            { docId: "b", relPath: "b.md", reason: "Sync paused", kind: "shrink-held" },
          ],
          limitCode: null,
        },
      }),
    );
    const paused = r.issues.filter((i) => i.kind === "sync-paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].severity).toBe("warn");
    expect(paused[0].autoRetries).toBe(true);
    expect(paused[0].why).toMatch(/노트 12개가 한꺼번에 비워져서/);
    expect(paused[0].why).toMatch(/이 기기에 안전하게/);
    expect(paused[0].explanation.next).toMatch(/약 20분/);
    expect(paused[0].facts).toContainEqual({ label: "동기화 대기 중인 노트", value: "2" });
    expect(r.issues.some((i) => i.docId === "a" || i.docId === "b")).toBe(false);
  });

  it("shows from a batch refusal alone, and not at all when nothing is paused", () => {
    const fromBatch = buildHealthReport(
      input({
        failures: {
          registry: [],
          content: [{ docId: "a", relPath: "a.md", reason: "Sync paused", kind: "shrink-held" }],
          limitCode: null,
        },
      }),
    );
    expect(fromBatch.issues.map((i) => i.kind)).toEqual(["sync-paused"]);
    expect(buildHealthReport(input()).issues.some((i) => i.kind === "sync-paused")).toBe(false);
  });
});
