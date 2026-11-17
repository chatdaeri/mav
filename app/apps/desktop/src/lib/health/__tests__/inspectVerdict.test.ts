// The "Check a note" box answers one question — "is THIS note safe?" — with one
// sentence. These tests are the guard on that sentence.
//
// Two ways it could lie, and both are here. It could claim a sync state for a
// note that is not on disk at all. And it could say "the server confirmed this"
// on anything weaker than a confirmation: a doc that was merely mapped, merely
// queued, or merely never reported this session. The order below is what keeps
// the most urgent true thing in front of the reader, because several of these
// facts are true at once on an unhappy note.

import { describe, expect, it } from "vitest";
import { composeInspectionVerdict, type InspectVerdictInput } from "../model";
import type { HealthIssue } from "../types";

function v(over: Partial<InspectVerdictInput> = {}): string {
  return composeInspectionVerdict({
    exists: true,
    syncEnabled: true,
    issue: null,
    permanentFailure: null,
    queued: false,
    diverged: false,
    state: null,
    pushed: false,
    docId: "doc-1",
    ...over,
  });
}

const issue: HealthIssue = {
  key: "doc-1",
  docId: "doc-1",
  path: "A.md",
  kind: "too-large",
  severity: "error",
  title: "Too large to sync",
  why: "…",
  remedies: [],
  code: null,
  explanation: { meaning: "…", next: "…", fixes: ["…"], safety: "only-here" },
  facts: [],
  autoRetries: false,
};

describe("composeInspectionVerdict", () => {
  it("says there is no file before saying anything about syncing", () => {
    // Every later sentence describes a file. Saying "synced" about a path with
    // nothing at it would send someone looking for a note that isn't there.
    expect(v({ exists: false, state: "synced", pushed: true })).toBe(
      "이 경로에는 파일이 없어요.",
    );
  });

  it("says the folder doesn't sync before reporting any sync state", () => {
    expect(v({ syncEnabled: false, pushed: true, state: "synced" })).toContain(
      "동기화되지 않아서",
    );
  });

  it("points at the issue row when the note has one, ahead of every softer fact", () => {
    const out = v({ issue, queued: true, diverged: true, state: "synced", pushed: true });
    expect(out).toContain("Too large to sync");
    expect(out).toContain("확인 필요");
  });

  it("reports a remembered permanent failure when no issue row covers it", () => {
    const out = v({ permanentFailure: "too large to sync (12.4 MB; the limit is 10 MB)" });
    expect(out).toContain("더 이상 시도하지 않아요");
    expect(out).toContain("12.4 MB");
  });

  it("prefers 'queued' over 'diverged' — the queue is the thing about to act", () => {
    expect(v({ queued: true, diverged: true })).toContain("업로드 대기 중");
    expect(v({ diverged: true })).toContain("원격 볼트에 아직 없을 수 있는 편집");
  });

  it("only claims a confirmation when BOTH the report and the checkpoint agree", () => {
    expect(v({ state: "synced", pushed: true })).toBe(
      "동기화됨. 원격 볼트가 이 노트의 내용을 확인했어요.",
    );
    // A `synced` report with no durable checkpoint is not a confirmation, and
    // a checkpoint with a live `unsynced` state is not one either.
    for (const weak of [
      v({ state: "synced", pushed: false }),
      v({ state: "unsynced", pushed: true }),
    ]) {
      expect(weak).toContain("아직 확인되지 않았어요");
      expect(weak).not.toContain("원격 볼트가 이 노트의 내용을 확인했어요");
    }
  });

  it("explains a pushed note nothing has spoken for this session", () => {
    expect(v({ pushed: true, state: null })).toContain("바뀐 것은 없어요");
  });

  it("says the Remote Vault doesn't know an unmapped note", () => {
    expect(v({ docId: null })).toBe("원격 볼트가 아직 이 노트를 몰라요.");
  });

  it("falls back to 'not confirmed', never to something reassuring", () => {
    const out = v({ state: "unsynced" });
    expect(out).toContain("아직 확인되지 않았어요");
    expect(out).not.toContain("동기화됨");
  });
});
