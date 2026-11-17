import { describe, expect, it } from "vitest";
import {
  heldProgress,
  isSyncRunActive,
  shownRunActive,
  SYNC_RUN_HOLD_MS,
  syncBadgeHold,
  syncBadgeLabel,
  syncBadgeTone,
  syncRunPercent,
} from "../Identity";
import type { SyncProgress } from "../../lib/sync/vaultScope";

// The sync pill is the user-facing "is my work safe?" signal. These lock in the
// fix for the bug where it drifted to "동기화됨 · 5분 전" while actively editing:
// pending edits must read "동기화 중…", and a fresh flush must read "just now".
describe("syncBadgeLabel", () => {
  const now = 1_000_000_000_000;

  it("counts remaining access cleanup even while the open note is denied", () => {
    const progress: SyncProgress = { phase: "removing", done: 64, total: 130, failed: 0 };
    expect(syncBadgeLabel({ status: "no-access", now, progress })).toBe("권한 업데이트 중 · 66개 남음");
    expect(syncBadgeLabel({ status: "no-access", now, progress: { ...progress, done: 128 } })).toBe("권한 업데이트 중 · 2개 남음");
    expect(syncBadgeTone({ status: "no-access", progress })).toBe("connecting");
    expect(isSyncRunActive(progress)).toBe(true);
  });

  // #258: an interrupted first upload resumes visibly, counting what is left.
  it("names the notes still to upload while their content is missing on the server", () => {
    const progress: SyncProgress = {
      phase: "uploading",
      done: 10,
      total: 500,
      failed: 0,
      notUploaded: 412,
    };
    expect(syncBadgeLabel({ status: "synced", now, progress })).toBe("업로드 중 · 노트 412개 남음");
    expect(syncBadgeLabel({ status: "synced", now, progress: { ...progress, notUploaded: 1 } })).toBe(
      "업로드 중 · 노트 1개 남음",
    );
    // Nothing missing: the ordinary counter, so a synced vault never reads "Uploading".
    expect(syncBadgeLabel({ status: "synced", now, progress: { ...progress, notUploaded: undefined } })).toBe(
      "동기화 중 10/500",
    );
    // Only while uploading: the download half of the run keeps its own counter.
    expect(syncBadgeLabel({ status: "synced", now, progress: { ...progress, phase: "downloading" } })).toBe(
      "동기화 중 10/500",
    );
  });

  it("never reads 'Sync incomplete': a stopped run falls back to the connection", () => {
    const stalled: SyncProgress = { phase: "error", done: 0, total: 0, failed: 0 };
    expect(syncBadgeLabel({ status: "connecting", now, progress: stalled })).toBe("동기화 중…");
    expect(syncBadgeLabel({ status: "error", now, progress: stalled })).toBe("다시 시도 중…");
    expect(
      syncBadgeLabel({ status: "synced", now, progress: { ...stalled, failed: 2 } }),
    ).toBe("동기화됨");
    expect(syncBadgeLabel({ status: "synced", now, progress: stalled })).toBe("동기화됨");
    expect(syncBadgeTone({ status: "synced", progress: stalled })).toBe("synced");
  });

  it("shows Syncing… while local edits are pending, ignoring the timestamp", () => {
    expect(
      syncBadgeLabel({ status: "synced", pending: true, lastSyncedAt: now - 300_000, now }),
    ).toBe("동기화 중…");
  });

  it("reads 'Synced · just now' immediately after a flush", () => {
    expect(
      syncBadgeLabel({ status: "synced", pending: false, lastSyncedAt: now, now }),
    ).toBe("동기화됨 · 방금");
  });

  it("counts up from the last flush once settled", () => {
    expect(
      syncBadgeLabel({ status: "synced", pending: false, lastSyncedAt: now - 300_000, now }),
    ).toBe("동기화됨 · 5분 전");
  });

  it("falls back to 'Synced' when there is no timestamp yet", () => {
    expect(syncBadgeLabel({ status: "synced", lastSyncedAt: null, now })).toBe("동기화됨");
  });

  it("maps the non-synced statuses to fixed labels", () => {
    expect(syncBadgeLabel({ status: "read-only", now })).toBe("읽기 전용");
    expect(syncBadgeLabel({ status: "connecting", now })).toBe("동기화 중…");
    expect(syncBadgeLabel({ status: "no-access", now })).toBe("접근 불가");
    expect(syncBadgeLabel({ status: "error", now })).toBe("다시 시도 중…");
    expect(syncBadgeLabel({ status: "offline", now })).toBe("오프라인");
    expect(syncBadgeLabel({ status: "offline", enabled: false, now })).toBe("이 기기에만");
  });
});

/** The vault's bulk-run progress is independent of the socket status: these lock
 *  in that a live run is never allowed to read as "동기화됨". */
describe("syncBadgeLabel with a bulk sync run", () => {
  const now = 1_000_000_000_000;
  const run = (p: Partial<SyncProgress>): SyncProgress => ({
    phase: "uploading",
    done: 0,
    total: 0,
    failed: 0,
    ...p,
  });

  it("reports counted progress instead of 'Synced' while a run is live", () => {
    // The socket IS synced and the last flush WAS just now — and 372 of 500 notes
    // have still never reached the server. This is the exact lie being fixed.
    expect(
      syncBadgeLabel({
        status: "synced",
        lastSyncedAt: now,
        now,
        progress: run({ phase: "uploading", done: 128, total: 500 }),
      }),
    ).toBe("동기화 중 128/500");
  });

  it("clamps a racing counter so it can never read 585/164", () => {
    expect(
      syncBadgeLabel({
        status: "synced",
        now,
        progress: run({ phase: "registering", done: 585, total: 164 }),
      }),
    ).toBe("동기화 중 164/164");
  });

  it("counts the registering and downloading phases too, all under one verb", () => {
    expect(
      syncBadgeLabel({
        status: "connecting",
        now,
        progress: run({ phase: "registering", done: 3, total: 40 }),
      }),
    ).toBe("동기화 중 3/40");
    // Every phase reads "Syncing" — the per-phase verbs described mechanism,
    // not the user's situation ("Uploading files" on an already-synced vault
    // read as "my vault is being re-sent").
    expect(
      syncBadgeLabel({
        status: "synced",
        now,
        progress: run({ phase: "downloading", done: 9, total: 10 }),
      }),
    ).toBe("동기화 중 9/10");
  });

  it("stays green while a run has opened a phase with nothing to do yet", () => {
    // The reconcile opens `registering` at 0 and the bulk engine `downloading`
    // at 0 before either knows of any work; that is not news for the pill.
    for (const phase of ["registering", "downloading", "uploading"] as const) {
      const progress = run({ phase, done: 0, total: 0 });
      expect(isSyncRunActive(progress)).toBe(false);
      expect(syncBadgeLabel({ status: "synced", now, progress })).not.toMatch(/^동기화 중/);
      expect(syncBadgeTone({ status: "synced", progress })).toBe("synced");
      expect(syncBadgeLabel({ status: "synced", now, progress, noteOpen: false, vaultStatus: "synced" })).toBe("동기화됨");
      expect(syncBadgeTone({ status: "synced", progress, noteOpen: false, vaultStatus: "synced" })).toBe("synced");
    }
  });

  it("still shows counts once a phase has real work outstanding", () => {
    const progress = run({ phase: "downloading", done: 3, total: 40 });
    expect(isSyncRunActive(progress)).toBe(true);
    expect(syncBadgeLabel({ status: "synced", now, progress })).toBe("동기화 중 3/40");
    expect(syncBadgeTone({ status: "synced", progress })).toBe("connecting");
    // A phase whose work is all done is settled again.
    expect(isSyncRunActive(run({ phase: "downloading", done: 40, total: 40 }))).toBe(false);
    // An upload with notes the server never had stays live whatever its counts.
    expect(isSyncRunActive(run({ phase: "uploading", done: 0, total: 0, notUploaded: 2 }))).toBe(true);
  });

  it("reads Synced — never 'N not synced' — when a run ends with failed notes", () => {
    // Per-note failures belong to the Health page. On the pill a finished run
    // is a finished run: no count, no amber, no stuck state.
    const failedRun = run({ phase: "error", done: 500, total: 500, failed: 20 });
    expect(
      syncBadgeLabel({ status: "synced", lastSyncedAt: now, now, progress: failedRun }),
    ).toBe("동기화됨 · 방금");
    expect(syncBadgeTone({ status: "synced", progress: failedRun })).toBe("synced");
    expect(
      syncBadgeLabel({ status: "offline", now, noteOpen: false, vaultStatus: "synced", progress: failedRun }),
    ).toBe("동기화됨");
    expect(
      syncBadgeTone({ status: "offline", noteOpen: false, vaultStatus: "synced", progress: failedRun }),
    ).toBe("synced");
    // Genuine connectivity states still win over the settled run.
    expect(syncBadgeLabel({ status: "error", now, progress: failedRun })).toBe("다시 시도 중…");
    expect(syncBadgeLabel({ status: "offline", now, progress: failedRun })).toBe("오프라인");
    expect(
      syncBadgeLabel({ status: "synced", now, progress: run({ phase: "error" }) }),
    ).toBe("동기화됨");
  });

  it("goes back to the connection label once the run is done", () => {
    expect(
      syncBadgeLabel({
        status: "synced",
        lastSyncedAt: now,
        now,
        progress: run({ phase: "done", done: 500, total: 500 }),
      }),
    ).toBe("동기화됨 · 방금");
    expect(
      syncBadgeLabel({ status: "offline", enabled: false, now, progress: null }),
    ).toBe("이 기기에만");
  });

  it("lets a grant fact about the open note outrank the run", () => {
    const progress = run({ done: 1, total: 9 });
    expect(syncBadgeLabel({ status: "no-access", now, progress })).toBe("접근 불가");
    expect(syncBadgeLabel({ status: "read-only", now, progress })).toBe("읽기 전용");
  });

  it("keeps the tone consistent with the words", () => {
    expect(syncBadgeTone({ status: "synced", progress: run({ done: 1, total: 9 }) })).toBe(
      "connecting",
    );
    expect(syncBadgeTone({ status: "synced", progress: run({ phase: "error" }) })).toBe(
      "synced",
    );
    expect(syncBadgeTone({ status: "synced", progress: run({ phase: "done" }) })).toBe(
      "synced",
    );
    expect(
      syncBadgeTone({ status: "read-only", progress: run({ done: 1, total: 9 }) }),
    ).toBe("read-only");
    expect(syncBadgeTone({ status: "offline" })).toBe("offline");
  });

  it("knows which phases are live", () => {
    expect(isSyncRunActive(null)).toBe(false);
    expect(isSyncRunActive(run({ phase: "idle" }))).toBe(false);
    expect(isSyncRunActive(run({ phase: "done" }))).toBe(false);
    expect(isSyncRunActive(run({ phase: "error" }))).toBe(false);
    for (const phase of ["registering", "uploading", "downloading"] as const) {
      expect(isSyncRunActive(run({ phase, done: 1, total: 5 }))).toBe(true);
      expect(isSyncRunActive(run({ phase, done: 0, total: 0 }))).toBe(false);
    }
  });

  it("stays honest with no note open: the run, then the vault channel", () => {
    // The header pill is now mounted vault-wide. With no note open, `status`
    // belongs to a socket that doesn't exist — it must never leak into the label.
    expect(
      syncBadgeLabel({
        status: "offline",
        now,
        noteOpen: false,
        progress: run({ phase: "downloading", done: 128, total: 500 }),
      }),
    ).toBe("동기화 중 128/500");
    expect(
      syncBadgeLabel({
        status: "offline",
        now,
        noteOpen: false,
        vaultStatus: "synced",
        progress: run({ phase: "done", done: 500, total: 500 }),
      }),
    ).toBe("동기화됨");
    expect(
      syncBadgeLabel({
        status: "synced",
        now,
        noteOpen: false,
        vaultStatus: "synced",
        progress: run({ phase: "error", done: 480, total: 500, failed: 20 }),
      }),
    ).toBe("동기화됨");
    // Stale grant facts from the last open note don't apply either.
    expect(
      syncBadgeLabel({
        status: "no-access",
        now,
        noteOpen: false,
        progress: run({ phase: "uploading", done: 1, total: 9 }),
      }),
    ).toBe("동기화 중 1/9");
  });

  it("keeps the vault-wide tone consistent with the vault-wide words", () => {
    expect(
      syncBadgeTone({
        status: "offline",
        noteOpen: false,
        progress: run({ done: 1, total: 9 }),
      }),
    ).toBe("connecting");
    expect(
      syncBadgeTone({
        status: "offline",
        noteOpen: false,
        vaultStatus: "synced",
        progress: run({ phase: "done" }),
      }),
    ).toBe("synced");
    expect(
      syncBadgeTone({
        status: "synced",
        noteOpen: false,
        vaultStatus: "synced",
        progress: run({ phase: "error", failed: 3 }),
      }),
    ).toBe("synced");
    expect(
      syncBadgeTone({
        status: "no-access",
        noteOpen: false,
        progress: run({ done: 1, total: 9 }),
      }),
    ).toBe("connecting");
  });

  // A stopped run says nothing about the channel: with no note open the pill
  // reads the vault channel's live status and never claims Synced on its own.
  it("never says Synced for the vault unless the vault channel is synced", () => {
    const stopped = run({ phase: "done", done: 500, total: 500 });
    const failed = run({ phase: "error", done: 0, total: 0, failed: 0 });
    for (const progress of [stopped, failed, null]) {
      const label = (vaultStatus?: string, enabled?: boolean) =>
        syncBadgeLabel({ status: "synced", now, noteOpen: false, vaultStatus, enabled, progress });
      const tone = (vaultStatus?: string) =>
        syncBadgeTone({ status: "synced", noteOpen: false, vaultStatus, progress });
      expect(label("synced")).toBe("동기화됨");
      expect(tone("synced")).toBe("synced");
      expect(label("connecting")).toBe("동기화 중…");
      expect(tone("connecting")).toBe("connecting");
      expect(label("error")).toBe("다시 시도 중…");
      expect(tone("error")).toBe("error");
      expect(label("no-access")).toBe("접근 불가");
      expect(tone("no-access")).toBe("no-access");
      expect(label("offline")).toBe("오프라인");
      expect(label("offline", false)).toBe("이 기기에만");
      expect(tone("offline")).toBe("offline");
      // No channel status known: not Synced.
      expect(label(undefined)).toBe("오프라인");
      expect(tone(undefined)).toBe("offline");
    }
    // A live run still reports its counter, whatever the channel says.
    expect(
      syncBadgeLabel({
        status: "synced",
        now,
        noteOpen: false,
        vaultStatus: "connecting",
        progress: run({ phase: "downloading", done: 3, total: 9 }),
      }),
    ).toBe("동기화 중 3/9");
  });

  it("floors the bar's percentage and clamps it", () => {
    expect(syncRunPercent(null)).toBeNull();
    expect(syncRunPercent(run({ done: 0, total: 0 }))).toBeNull();
    expect(syncRunPercent(run({ done: 499, total: 500 }))).toBe(99);
    expect(syncRunPercent(run({ done: 500, total: 500 }))).toBe(100);
    // A denominator that shrank mid-run must not overflow the bar.
    expect(syncRunPercent(run({ done: 12, total: 10 }))).toBe(100);
  });
});

// #273: a vault-wide hold outranks every per-note/per-run state, in every badge
// that renders through SyncBadge — Vault Settings once read "Synced · 9m ago"
// while the tab-bar pill said "동기화 일시 중지".
describe("syncBadgeHold", () => {
  const now = 1_000_000_000_000;

  it("is null when nothing holds sync", () => {
    expect(syncBadgeHold({ now })).toBeNull();
    expect(syncBadgeHold({ enabled: true, pause: null, now })).toBeNull();
  });

  it("reads a neutral Paused while the vault folder is missing (#228)", () => {
    const hold = syncBadgeHold({ rootMissing: true, enabled: true, pause: { until: null }, now });
    expect(hold).toEqual({
      tone: "offline",
      label: "일시 중지됨",
      title: "볼트 폴더가 돌아올 때까지 동기화가 일시 중지돼요",
    });
  });

  it("reads an amber Sync paused while the shrink brake holds writes (#252)", () => {
    const hold = syncBadgeHold({ enabled: true, pause: { until: now + 10 * 60_000 }, now });
    expect(hold?.tone).toBe("connecting");
    expect(hold?.label).toBe("동기화 일시 중지");
    expect(hold?.title).toContain("(남은 시간: ");
    expect(syncBadgeHold({ enabled: true, pause: { until: null }, now })?.title).not.toContain("(in ");
  });

  it("ignores a brake on a vault whose sync is off", () => {
    expect(syncBadgeHold({ enabled: false, pause: { until: null }, now })).toBeNull();
  });
});

// Held create refusals and a failing registry pull have their own surfaces
// (the refusal banner, the sidebar's vault badge, Activity). The header pill
// no longer reports them: it never reads "Sync incomplete" and offers no
// "Sync now" action, falling back to the open note's connection instead.
describe("a stopped run with refusals or a failing pull", () => {
  const now = 1_000_000_000_000;
  const runs: SyncProgress[] = [
    { phase: "error", done: 3, total: 3, failed: 2, refused: 2 },
    { phase: "error", done: 0, total: 0, failed: 0, refused: 2 },
    { phase: "error", done: 3, total: 3, failed: 2, pullFailing: true },
    { phase: "error", done: 0, total: 0, failed: 0, pullFailing: true },
  ];

  it("reads the connection's label, never Sync incomplete", () => {
    for (const progress of runs) {
      expect(syncBadgeLabel({ status: "synced", now, progress, lastSyncedAt: now })).toBe("동기화됨 · 방금");
      expect(syncBadgeLabel({ status: "synced", now, progress })).not.toBe("Sync incomplete");
      expect(syncBadgeTone({ status: "synced", progress })).toBe("synced");
      expect(
        syncBadgeLabel({ status: "offline", now, noteOpen: false, vaultStatus: "synced", progress }),
      ).toBe("동기화됨");
      expect(
        syncBadgeLabel({ status: "offline", now, noteOpen: false, vaultStatus: "error", progress }),
      ).toBe("다시 시도 중…");
    }
  });

  it("still lets a grant fact about the open note win", () => {
    for (const progress of runs) {
      expect(syncBadgeLabel({ status: "read-only", now, progress })).toBe("읽기 전용");
      expect(syncBadgeTone({ status: "read-only", progress })).toBe("read-only");
    }
  });
});

describe("the hold before a new run turns the pill amber", () => {
  const busy: SyncProgress = { phase: "downloading", done: 2, total: 50, failed: 0 };

  it("holds a run that just appeared, then shows it", () => {
    const t0 = 1_000;
    expect(SYNC_RUN_HOLD_MS).toBeGreaterThanOrEqual(400);
    expect(SYNC_RUN_HOLD_MS).toBeLessThanOrEqual(600);
    expect(shownRunActive(null, t0)).toBe(false);
    expect(shownRunActive(t0, t0)).toBe(false);
    expect(shownRunActive(t0, t0 + SYNC_RUN_HOLD_MS - 1)).toBe(false);
    expect(shownRunActive(t0, t0 + SYNC_RUN_HOLD_MS)).toBe(true);
  });

  it("renders a held run as settled and a shown run as itself", () => {
    const held = heldProgress(busy, false);
    expect(held?.phase).toBe("done");
    expect(syncBadgeTone({ status: "synced", progress: held })).toBe("synced");
    expect(heldProgress(busy, true)).toBe(busy);
    expect(syncBadgeTone({ status: "synced", progress: heldProgress(busy, true) })).toBe("connecting");
    // Nothing to hold: inactive progress passes through untouched.
    const quiet: SyncProgress = { phase: "registering", done: 0, total: 0, failed: 0 };
    expect(heldProgress(quiet, false)).toBe(quiet);
    expect(heldProgress(null, false)).toBeNull();
  });
});
