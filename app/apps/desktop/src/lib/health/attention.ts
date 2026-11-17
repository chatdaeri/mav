// Small pure helpers behind the Health page's summary figures: the nav badge,
// the "Files & attachments" size, and the bulk runner for left-on-disk notes.
// Kept apart from the hooks so each decision is testable without React.

import type { HealthFailures } from "./model";
import type { HealthInventory, HealthIssue, HealthIssueKind, VaultStats } from "./types";

/**
 * How many sync failures need a PERSON: a note over the size cap, a local edit
 * refused for lack of write access, or a file left on disk because the Remote
 * Vault dropped it before this device confirmed its content. Everything else
 * (timeouts, push failures, registry retries) heals by itself and never counts,
 * so the badge cannot nag about work 마브 is already redoing.
 */
export function actionNeededCount(failures: HealthFailures | null | undefined): number {
  if (!failures) return 0;
  const content = failures.content.filter(
    (f) => f.kind === "too-large" || f.kind === "no-write-access",
  ).length;
  const orphans = failures.registry.filter((f) => f.kind === "orphan").length;
  return content + orphans;
}

/**
 * This computer's side of "Files & attachments": the bytes of embedded
 * attachments plus standalone non-note files on disk. Deliberately NOT note
 * text, the index or edit history — the Remote Vault's storage figure counts
 * only file/attachment blobs, and both cards must measure the same thing for a
 * synced vault to show matching numbers. Null while the census is unknown.
 */
export function localFilesBytes(stats: VaultStats | null | undefined): number | null {
  if (!stats) return null;
  return stats.attachments.bytes + stats.otherFiles.bytes;
}

export interface EachOutcome {
  done: number;
  total: number;
  failed: Array<{ path: string; reason: string }>;
}

/**
 * Run one per-item remedy over many paths, one at a time: the remedies write to
 * the registry and the disk, and a serial run keeps each refusal attributable
 * to its own path. A failure is recorded and the run continues.
 */
export async function runEach(
  paths: readonly string[],
  run: (path: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<EachOutcome> {
  const failed: EachOutcome["failed"] = [];
  let done = 0;
  const total = paths.length;
  onProgress?.(done, total);
  for (const path of paths) {
    try {
      await run(path);
    } catch (e) {
      failed.push({ path, reason: e instanceof Error ? e.message : String(e) });
    }
    done++;
    onProgress?.(done, total);
  }
  return { done, total, failed };
}

// ── Needs attention: one item, one place ─────────────────────────────────────

/**
 * Drop difference-group paths that an issue already covers. The issue wins: it
 * carries the reason and the action, so listing the same path again under
 * "missing from the Remote Vault" only repeats it with less to say. Paths
 * compare case-insensitively, like everywhere else in sync.
 */
export function dedupeDifferences(
  inventory: HealthInventory,
  issues: readonly Pick<HealthIssue, "path">[],
): HealthInventory {
  const covered = new Set(
    issues.filter((i) => i.path).map((i) => (i.path as string).toLowerCase()),
  );
  if (covered.size === 0) return inventory;
  const keep = (paths: string[]) => paths.filter((p) => !covered.has(p.toLowerCase()));
  return {
    ...inventory,
    deviceOnlyNotes: keep(inventory.deviceOnlyNotes),
    serverOnlyNotes: keep(inventory.serverOnlyNotes),
    deviceOnlyFolders: keep(inventory.deviceOnlyFolders),
    serverOnlyFolders: keep(inventory.serverOnlyFolders),
    deviceOnlyFiles: keep(inventory.deviceOnlyFiles),
    serverOnlyFiles: keep(inventory.serverOnlyFiles),
  };
}

const count = (n: number) => n.toLocaleString();

/** The group header for one kind of issue, in plain words. The rows under it
 *  then need nothing but their path. */
export function issueGroupTitle(kind: HealthIssueKind, n: number): string {
  switch (kind) {
    case "too-large":
      return `동기화하기엔 너무 큰 노트 ${count(n)}개`;
    case "no-write-access":
      return `읽기 전용 권한으로 막힌 편집 ${count(n)}건`;
    case "upload-failed":
      return `업로드하지 못한 노트 ${count(n)}개`;
    case "register-failed":
      return `원격 볼트에 추가하지 못한 항목 ${count(n)}개`;
    case "limit":
      return "요금제 한도에 도달했어요";
    case "unregistered":
      return `등록되지 않은 노트 ${count(n)}개`;
    case "no-access":
      return "접근 불가";
    case "left-behind":
      return `디스크에만 남은 노트 ${count(n)}개`;
    case "materialize-failed":
      return `이 컴퓨터에 쓰지 못한 노트 ${count(n)}개`;
    case "inbound-blocked":
      return `안전을 위해 보류된 로컬 변경 ${count(n)}건`;
    case "orphan-history":
      return "남은 편집 기록";
    case "linked-paths":
      return "동기화에서 제외된 링크 경로";
    case "shared-file":
      return `여러 노트가 함께 쓰는 파일 ${count(n)}개`;
    case "sync-paused":
      return "동기화 일시 중지";
  }
}

/** What a path-less row says instead of a path — one short sentence. */
export function issueRowSentence(issue: Pick<HealthIssue, "kind" | "title">): string {
  switch (issue.kind) {
    case "no-access":
      return "이 볼트에 접근할 권한이 없어요";
    case "limit":
      return "요금제 한도 때문에 새 노트가 동기화되지 않아요";
    case "orphan-history":
      return "이 볼트에 더 이상 없는 노트의 기록이 남아 있어요";
    case "sync-paused":
      return "한꺼번에 많은 노트가 비워져서 동기화가 잠시 중지됐어요";
    default:
      return issue.title;
  }
}
