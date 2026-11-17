// Vault Health — folding store + sync-layer state into the one report the
// Health tab renders.
//
// Pure and dependency-free, exactly like `syncRollup.ts` and `locks.ts`: plain
// data in, plain data out, no React, no Tauri, no store. Every input is passed
// by the hook (`useVaultHealth.ts`), so the whole verdict is unit-testable and
// so this module can never accidentally acquire a side effect.
//
// THE RULE THIS FILE EXISTS TO KEEP: honesty over optimism. The page is the
// answer to "is my work safe?", so nothing here may report a note as synced
// that nothing confirmed. The counts come straight from `buildTreeSyncIndex` —
// which already refuses to credit an unmapped note, keeps an honest denominator
// and tracks `unreported` separately — rather than being recomputed here, and
// the verdict degrades to the WORST applicable state rather than the friendliest.

import { buildTreeSyncIndex } from "../syncRollup";
// `format.ts` is the one place elapsed time is worded, so the verdict card's
// "Last confirmed …" cannot phrase it differently from the table rows directly
// under it. That module imports a type and nothing else, so this keeps the model
// dependency-free.
import { formatBytes, relativeTime } from "./format";
import { BRAND_NAME } from "../brand";
import {
  groupCreateRefusals,
  isHeldCreateCode,
  wherePhrase,
  type CreateRefusalGroup,
} from "../sync/createRefusals";
import { isBulkPhase, type DocSyncState, type SyncProgress } from "../sync/vaultScope";
import type { SyncStatus } from "../sync/syncManager";
import type { AuthStatus } from "../../store";
import type {
  HealthCounts,
  HealthExplanation,
  HealthFact,
  HealthIssue,
  HealthRemedy,
  HealthReport,
  HealthStage,
  HealthStageState,
  HealthVerdict,
  VaultChecks,
  VaultStats,
} from "./types";

// ── Inputs ────────────────────────────────────────────────────────────────────

/** One note's content push that did not land. Mirrors `contentUpload.ts`
 *  `UploadFailure` and the `content` half of `SyncManager.syncFailures()`. */
export interface HealthContentFailure {
  docId: string;
  relPath: string;
  reason: string;
  /** Retrying cannot help without changing the note or its access. */
  permanent?: boolean;
  /** User-facing diagnosis. `permanent` is scheduling metadata, not a cause. */
  kind?: "too-large" | "no-write-access" | "shrink-held";
}

/** One row the registry could not create/move. Mirrors `registry.ts`
 *  `RegistryFailure`. Kept structural so the model needs no value import from
 *  the sync layer. */
export interface HealthRegistryFailure {
  kind: "folder" | "note" | "materialize" | "inbound" | "inbound-blocked" | "orphan" | "pull";
  path: string;
  docId: string | null;
  reason: string;
  code: string | null;
}

/** Exactly what `syncManager.syncFailures()` returns. */
export interface HealthFailures {
  registry: HealthRegistryFailure[];
  content: HealthContentFailure[];
  /** The plan limit that stopped the run, if one did. */
  limitCode: string | null;
}

export interface HealthInput {
  /** `store.syncEnabled` — is the sync layer live for this vault? */
  syncEnabled: boolean;
  /** `store.vaultReadySeen` — the one "synced" rule (`TreeSyncInput.serverSettled`):
   *  after the server's first `ready`, a mapped note it did not name is synced. */
  serverSettled?: boolean;
  /** `store.vaultSyncStatus` — the vault channel, independent of note permissions. */
  syncStatus: SyncStatus;
  /** `store.authStatus`. */
  authStatus: AuthStatus;
  /** True once a session object exists (`store.session != null`) — mirrors
   *  `notSyncingReason`'s own check, so a half-established session cannot read
   *  as signed in. */
  hasSession: boolean;
  /** `store.openFolderIsSynced`: the folder's own `.context` stamp, or null
   *  while the peek is still in flight. */
  openFolderIsSynced: boolean | null;
  syncProgress: SyncProgress | null;
  lastSyncedAt: number | null;
  /** `store.serverUrl`; only its host is shown. */
  serverUrl: string;
  now: number;
  /** `store.docIdByPath`. */
  docIdByPath: Record<string, string>;
  /** `store.docSyncState`. */
  docSyncState: Record<string, DocSyncState>;
  /** Every note path the local index knows (`store.titles`). */
  localNotePaths: Iterable<string>;
  failures: HealthFailures;
  /** The Rust census, when it has landed. */
  stats: VaultStats | null;
  /** The Rust integrity checks (`ipc.vaultChecks`), when they have landed. Only
   *  their link findings (#216) become issues; the rest render as checks. */
  checks?: VaultChecks | null;
  /** `store.members` — the vault's roster, used ONLY to name the owner in an
   *  access explanation ("Ask <name> …"). Structural on purpose so the model
   *  needs no value import from `lib/api.ts`; absent ⇒ the explanations fall
   *  back to "볼트 소유자". */
  members?: HealthMember[];
  /** `store.syncPause` — the server's shrink burst brake holding this
   *  account's writes in the vault (#252). Absent ⇒ none. */
  syncPause?: { until: number | null; count: number | null } | null;
}

/** The one shape the model needs out of `api.Member`. */
export interface HealthMember {
  role: string;
  user?: { name: string; email: string };
}

/** Who to ask for access. Null when the roster hasn't loaded or has no owner —
 *  in which case every sentence says "볼트 소유자" rather than guessing. */
export function ownerOf(members: HealthMember[] | undefined): {
  name: string;
  email: string;
} | null {
  const owner = members?.find((m) => m.role === "owner");
  const user = owner?.user;
  if (!user) return null;
  const name = user.name.trim() === "" ? user.email : user.name;
  return { name, email: user.email };
}

/** "Ben (ben@example.com)" or "볼트 소유자". */
function ownerPhrase(owner: { name: string; email: string } | null): string {
  return owner ? `${owner.name} (${owner.email})` : "볼트 소유자";
}

// ── Small text helpers (deliberately `Intl`-free) ─────────────────────────────

/** Thousands separators without pulling in `Intl` — the tests compare strings. */
export function num(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
}

function plural(n: number, word: string): string {
  return `${word} ${num(n)}개`;
}

/** Host of the server this vault syncs against, or null when unparseable. */
export function serverHostOf(serverUrl: string): string | null {
  try {
    const host = new URL(serverUrl).host;
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

// ── Failure → issue mapping ───────────────────────────────────────────────────

/** Plan-limit codes. Only two exist server-side today (`auth/auth.ts`), but any
 *  future `*_limit_reached` is the same conversation with the user. */
export function isLimitCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code.endsWith("_limit_reached");
}

/**
 * The per-note ceiling, mirroring `sync/contentUpload.ts` `MAX_NOTE_BYTES` and
 * the server's `MAX_NOTE_MB`. Mirrored rather than imported because that module
 * pulls in Yjs and the provider, and this one is the dependency-free half that
 * has to stay importable from a plain Node test. **Change one, change both.**
 *
 * It is only a fallback: when the sync layer's own reason carries the cap (it
 * always does today) the issue quotes THAT number, so a server configured with
 * a different `MAX_NOTE_MB` still reads correctly.
 */
export const NOTE_SIZE_LIMIT_MB = 10;

interface TooLargeParse {
  /** Which half is over the cap, per the reason the uploader recorded. */
  cause: "history" | "file" | "unknown";
  /** The measured size in MB, as the uploader formatted it. */
  sizeMb: string | null;
  capMb: string | null;
}

/**
 * Pull the two numbers out of `contentUpload.ts`'s too-large reason so the issue
 * can say "12.4 MB; the limit is 10 MB" in the user's own terms rather than
 * echoing an engineer's sentence. Two shapes exist — the FILE is over the cap,
 * or the doc's edit HISTORY is — and they have different remedies, so they are
 * told apart here rather than merged.
 */
function parseTooLarge(reason: string): TooLargeParse {
  const m = /\(([\d.]+) MB( of edit history)?; the limit is (\d+) MB\)/.exec(reason);
  if (!m) return { cause: "unknown", sizeMb: null, capMb: null };
  const [, size, history, cap] = m;
  return { cause: history ? "history" : "file", sizeMb: size, capMb: cap };
}

/** What the census knows about one note, when the census has landed and the note
 *  is big enough to be in one of its top-10 lists. Both are `null` otherwise —
 *  absence here is "not measured", never "small". */
function censusSizes(
  stats: VaultStats | null,
  path: string | null,
  docId: string | null,
): { fileBytes: number | null; historyBytes: number | null } {
  if (!stats) return { fileBytes: null, historyBytes: null };
  const file = path ? stats.largestNotes.find((n) => n.path === path) : undefined;
  const hist = docId ? stats.heaviestHistory.find((h) => h.docId === docId) : undefined;
  return { fileBytes: file?.bytes ?? null, historyBytes: hist?.bytes ?? null };
}

interface IssueContext {
  stats: VaultStats | null;
  owner: { name: string; email: string } | null;
}

function pathFact(path: string | null): HealthFact[] {
  return path ? [{ label: "경로", value: path }] : [];
}

function docIdFact(docId: string | null): HealthFact[] {
  return docId ? [{ label: "문서 ID", value: docId, copyable: true }] : [];
}

function tooLargeIssue(f: HealthContentFailure, ctx: IssueContext): HealthIssue {
  const parsed = parseTooLarge(f.reason);
  const { fileBytes, historyBytes } = censusSizes(ctx.stats, f.relPath, f.docId);
  const capMb = parsed.capMb ? Number(parsed.capMb) : NOTE_SIZE_LIMIT_MB;
  const capBytes = capMb * 1024 * 1024;

  // Three signals, in order of how much they actually know. The uploader's own
  // reason says which half it measured over the cap. The census can then settle
  // the case the reason cannot: a note whose FILE is comfortably under the cap
  // but whose stored edit history is over it is a history problem, and telling
  // someone to "split the note" there would send them to shorten a file that was
  // never the reason. The census never promotes a file to the cause on its own
  // absence — a note missing from the top-10 list is unmeasured, not small.
  let cause: "history" | "file" | "unknown" = parsed.cause;
  if (fileBytes != null && fileBytes > capBytes) cause = "file";
  else if (
    fileBytes != null &&
    fileBytes <= capBytes &&
    historyBytes != null &&
    historyBytes > capBytes
  ) {
    cause = "history";
  }

  const sizeText =
    cause === "file" && parsed.sizeMb
      ? `${parsed.sizeMb} MB`
      : fileBytes != null
        ? formatBytes(fileBytes)
        : null;
  const historyText =
    historyBytes != null
      ? formatBytes(historyBytes)
      : cause === "history" && parsed.sizeMb
        ? `${parsed.sizeMb} MB`
        : null;

  const why =
    cause === "history"
      ? `이 노트의 편집 기록이 ${historyText ?? "한도를 넘었어요"}. 원격 볼트는 노트당 ` +
        `최대 ${capMb}MB까지 받아요. 노트 본문은 문제가 아니에요.`
      : cause === "file"
        ? `이 노트는 ${sizeText ?? "한도를 넘었어요"}. 원격 볼트는 최대 ` +
          `${capMb}MB까지 받아요. 동기화하려면 크기를 줄여야 해요.`
        : `원격 볼트가 이 노트를 너무 크다는 이유로 거부했어요: ${f.reason}`;

  const meaning =
    cause === "history"
      ? "마이 세컨드 브레인은 오프라인 변경을 덮어쓰지 않고 병합할 수 있도록, 이 노트에 병합한 모든 편집을 " +
        "노트와 함께 저장해요. 저장된 기록이 원격 볼트가 받을 수 있는 크기를 넘어서 " +
        "노트 업로드가 멈췄어요. 본문은 이 기기에 그대로 있고, 과거 편집 기록만 너무 커요."
      : cause === "file"
        ? "노트 자체가 원격 볼트에서 허용하는 노트 크기보다 커요. 보통 큰 내용을 " +
          "파일 옆에 두지 않고 안에 붙여 넣어서 생겨요. 원격 볼트는 한도를 넘는 노트를 " +
          "받지 않으므로 이 기기에만 남아 있어요."
        : "원격 볼트가 크기 때문에 이 노트를 거부했어요. 마이 세컨드 브레인은 거부 사실만 기록했고 " +
          "어느 쪽이 너무 큰지는 기록하지 못했어요.";

  const fixes =
    cause === "history"
      ? [
          "이 노트의 기록을 초기화하세요. 저장된 편집 기록만 지우고 본문은 그대로 둬요. " +
            "대부분 이렇게 해결돼요.",
          "다시 생기면 자동화나 스크립트가 이 노트를 계속 고쳐 쓰고 있을 수 있어요. " +
            "그것부터 멈춘 뒤 다시 초기화하세요.",
        ]
      : cause === "file"
        ? [
            "큰 삽입 내용(이미지, PDF, 붙여 넣은 base64)을 노트에서 꺼내 " +
              "첨부 파일 폴더에 두고 링크로 연결하세요.",
            "노트를 여러 개의 작은 노트로 나누세요.",
            "볼트 밖에 사본을 저장한 뒤 이 노트를 줄이세요.",
          ]
        : [
            "볼트 밖에 사본을 저장해 두고, 이 노트의 기록을 초기화한 뒤 " +
              "노트를 줄이세요.",
          ];

  const remedies: HealthRemedy[] =
    cause === "history"
      ? ["reset-history", "open", "reveal", "export-copy", "delete", "copy-details"]
      : ["open", "reveal", "export-copy", "reset-history", "delete", "copy-details"];

  const facts: HealthFact[] = [
    ...pathFact(f.relPath),
    { label: "크기", value: sizeText ?? "이 페이지에서는 측정하지 않았어요" },
    { label: "한도", value: `노트당 ${capMb}MB` },
    ...(historyText ? [{ label: "기록 크기", value: historyText }] : []),
    ...docIdFact(f.docId),
    { label: "원본 사유", value: f.reason, copyable: true },
  ];

  return {
    key: f.docId,
    docId: f.docId,
    path: f.relPath,
    kind: "too-large",
    severity: "error",
    title: "동기화하기에는 너무 커요",
    why,
    remedies,
    code: null,
    explanation: {
      meaning,
      next: "할 일 없음. 노트가 작아질 때까지 마이 세컨드 브레인은 다시 시도하지 않아요.",
      fixes,
      safety: "only-here",
    },
    facts,
    autoRetries: false,
  };
}

/**
 * Turn one of the sync layer's recorded reasons into a sentence that says what
 * actually went wrong. Every shape matched here is a string that exists in
 * `contentUpload.ts` (`fail(...)` call sites) or comes out of `syncManager.ts`,
 * whose terminal statuses reject with the status as the message.
 *
 * Returns null for anything unrecognized — the issue then quotes the raw reason
 * rather than inventing a cause for it.
 */
export function classifyUploadReason(reason: string): string | null {
  const r = reason.trim().toLowerCase();
  if (r.startsWith("open failed")) {
    return (
      "마이 세컨드 브레인이 보내려고 이 노트의 로컬 사본을 열지 못해서 아무것도 " +
      "업로드되지 않았어요. 보통 파일 권한 문제이거나, 로컬 인덱스와 디스크의 " +
      "내용이 서로 다른 노트예요."
    );
  }
  if (r.includes("did not respond to the initial sync")) {
    return (
      "연결은 열렸지만 원격 볼트가 이 노트에 대해 이미 갖고 있는 내용을 보내오지 않았어요. " +
      "먼저 업로드하면 한 노트의 두 버전이 합쳐져 내용이 두 배가 될 수 있어서, 마이 세컨드 브레인은 " +
      "원격 볼트의 사본을 읽기 전에는 업로드하지 않아요. 보통 원격 볼트에 " +
      "연결할 수 없었거나 응답이 너무 느렸어요."
    );
  }
  if (r.includes("did not acknowledge the content")) {
    return (
      "내용은 보냈지만 원격 볼트가 저장했다는 확인을 보내오지 않았어요. " +
      "마이 세컨드 브레인은 추측만으로 노트를 동기화됨으로 표시하지 않아서 실패로 " +
      "보고해요. 연결이 끊겼거나 원격 볼트가 과부하일 때 이렇게 보여요."
    );
  }
  if (r === "no-access" || r.includes("403") || r.includes("forbidden")) {
    return (
      "원격 볼트가 이 노트를 거부했어요. 이 노트에 대한 권한이 보기 전용이거나 " +
      "회수됐어요. 권한이 복구되기 전까지는 여기서 입력한 내용이 원격 볼트에 " +
      "전달되지 않아요."
    );
  }
  if (r === "deleted" || r.includes("404") || r.includes("not found")) {
    return (
      "원격 볼트에 이 노트의 기록이 더 이상 없어요. 이 기기가 노트를 갖고 있는 동안 " +
      "원격에서 삭제됐어요. 디스크의 사본은 그대로예요."
    );
  }
  if (r === "too-large" || r.includes("too large")) {
    return "노트당 크기 한도를 넘어서 원격 볼트가 이 노트를 거부했어요.";
  }
  if (r.includes("401") || r.includes("unauthor")) {
    return (
      "원격 볼트가 이 기기의 로그인을 받아들이지 않았어요. 로그아웃한 뒤 " +
      "다시 로그인하면 보통 해결돼요."
    );
  }
  if (/\b5\d\d\b/.test(r) || r.includes("internal server error")) {
    return "원격 볼트가 이 노트를 저장하는 중 자체 오류가 났어요.";
  }
  if (r.includes("timed out") || r.includes("timeout")) {
    return "원격 볼트의 응답이 너무 오래 걸려서 마이 세컨드 브레인이 기다리기를 멈췄어요.";
  }
  if (
    r.includes("failed to fetch") ||
    r.includes("load failed") ||
    r.includes("network") ||
    r.includes("econnrefused") ||
    r.includes("enotfound") ||
    r.includes("socket")
  ) {
    return "이 기기가 원격 볼트에 연결하지 못해서 아무것도 보내지 못했어요.";
  }
  if (r === "error") {
    return "마이 세컨드 브레인이 이 노트를 위해 연 연결이 내용이 도착하기 전에 실패했어요.";
  }
  return null;
}

function uploadFailedIssue(f: HealthContentFailure): HealthIssue {
  const cause = classifyUploadReason(f.reason);
  return {
    key: f.docId,
    docId: f.docId,
    path: f.relPath,
    kind: "upload-failed",
    severity: "error",
    title: "업로드할 수 없어요",
    why:
      `이 노트의 내용이 원격 볼트에 도착하지 못했어요. ${capitalize(f.reason)} ` +
      `유일한 사본은 이 기기에 있어요.`,
    remedies: ["retry", "open", "reveal", "export-copy", "copy-details"],
    code: null,
    explanation: {
      meaning:
        (cause ? `${cause} ` : `마이 세컨드 브레인이 기록한 내용: ${capitalize(f.reason)} `) +
        "노트 자체는 안전해요. 마지막에 둔 그대로 이 기기의 디스크에 저장돼 있어요. " +
        "실패한 것은 원격 볼트로 보내는 사본이라서, 다른 기기와 팀원에게는 아직 " +
        "전달되지 않았어요.",
      next: "마이 세컨드 브레인은 다음에 연결될 때와 파일이 다시 바뀔 때 다시 시도해요.",
      fixes: [
        "바로 보내려면 지금 다시 시도하세요.",
        "온라인 상태인지, 원격 볼트에 연결할 수 있는지 확인하세요.",
        "이 기기에만 있는 동안 잃으면 안 되는 작업이라면 " +
          "볼트 밖에 사본을 저장해 두세요.",
      ],
      safety: "only-here",
    },
    facts: [
      ...pathFact(f.relPath),
      ...docIdFact(f.docId),
      { label: "마지막 오류", value: f.reason, copyable: true },
    ],
    autoRetries: true,
  };
}

function noWriteAccessIssue(f: HealthContentFailure): HealthIssue {
  const saved = f.reason.includes("copy saved to ");
  return {
    key: f.docId,
    docId: f.docId,
    path: f.relPath,
    kind: "no-write-access",
    severity: "error",
    title: "읽기 전용 동기화 확인 필요",
    why: saved
      ? "원격 볼트가 이 노트를 읽기 전용이라며 거부했어요. 마이 세컨드 브레인이 복구용 사본을 남긴 뒤 원격 볼트의 버전으로 되돌렸어요."
      : "원격 볼트가 이 노트를 읽기 전용이라며 거부했어요. 다시 확인해서 현재 로컬 본문과 원격 본문이 이미 같은지 확인하세요.",
    remedies: ["retry", "open", "reveal", "export-copy", "copy-details"],
    code: null,
    explanation: {
      meaning:
        "원격 볼트에는 확인된 사본이 그대로 있지만, 쓰기 권한이 없어서 이 기기가 보낸 상태는 받아들이지 않았어요.",
      next:
        "다시 확인하세요. 현재 본문이 원격 볼트와 이미 같다면 노트를 바꾸지 않고 경고만 사라져요.",
      fixes: saved
        ? [
            "다시 확인해서 현재 읽기 전용 사본을 원격 볼트와 비교하세요.",
            "세부 정보에 적힌 복구용 사본을 열고, 권한이 돌아오면 편집 내용을 복원하세요.",
          ]
        : [
            "다시 확인해서 현재 읽기 전용 사본을 원격 볼트와 비교하세요.",
            "경고가 계속되면 변경하기 전에 볼트 소유자에게 편집 권한을 요청하세요.",
          ],
      safety: "only-here",
    },
    facts: [
      ...pathFact(f.relPath),
      ...docIdFact(f.docId),
      { label: "마지막 오류", value: f.reason, copyable: true },
    ],
    autoRetries: false,
  };
}

function contentIssue(f: HealthContentFailure, ctx: IssueContext): HealthIssue {
  // The reason fallback keeps reports created by an older running session
  // intelligible across a hot UI update. New producers always set `kind`.
  if (f.kind === "too-large" || f.reason.toLowerCase().includes("too large")) {
    return tooLargeIssue(f, ctx);
  }
  if (f.kind === "no-write-access") return noWriteAccessIssue(f);
  return uploadFailedIssue(f);
}

function capitalize(s: string): string {
  const t = s.trim();
  if (t === "") return "";
  const head = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(head) ? head : `${head}.`;
}

/**
 * The one-line meaning of each `code` a create/move refusal can carry. These are
 * the only codes the server emits with a body (`http/routes/registry.ts`), and
 * the desktop's `registry.ts errorCode` is what puts them on the failure.
 */
function registerCodeMeaning(code: string | null, kind: "folder" | "note"): string | null {
  switch (code) {
    case "no_write_access":
      return (
        `이 폴더에 대한 권한이 보기 전용이라서 원격 볼트가 ${kind === "folder" ? "폴더" : "노트"} 만들기를 거부했어요.`
      );
    case "root_frozen":
      return (
        `이 볼트의 최상위는 잠겨 있어서 새 항목은 폴더 안에서만 만들 수 있어요. ` +
        `이 ${kind === "folder" ? "폴더" : "노트"}를 폴더 안으로 옮기면 등록돼요.`
      );
    case "path_folder_mismatch":
      return (
        `이 ${kind === "folder" ? "폴더" : "노트"}가 디스크에서 들어 있는 폴더와 원격 볼트에 기록된 폴더가 ` +
        `서로 달라요. 원격 볼트는 어느 쪽이 맞는지 추측하지 않고 요청을 거부했어요.`
      );
    case "doc_id_conflict":
      return (
        `이 ${kind === "folder" ? "폴더" : "노트"}의 ID가 원격 볼트의 다른 볼트에서 이미 쓰이고 있어서 ` +
        `같은 ID로는 여기서 만들 수 없어요.`
      );
    case "note_deleted":
      return (
        `다른 멤버가 원격 볼트에서 이 ${kind === "folder" ? "폴더" : "노트"}를 삭제했어요. 사본은 ` +
        `이 기기에 남아 있지만 더 이상 동기화되지 않아요. 삭제하거나, 내용을 새 ` +
        `${kind === "folder" ? "폴더" : "노트"}로 저장해 다시 공유하세요.`
      );
    default:
      return null;
  }
}

function limitIssue(f: HealthRegistryFailure): HealthIssue {
  const member = f.code === "member_limit_reached";
  const notes = f.code === "note_limit_reached";
  return {
    key: f.docId ?? f.path,
    docId: f.docId,
    path: f.path,
    kind: "limit",
    severity: "error",
    title: "요금제 한도에 도달했어요",
    why: notes ? "이 볼트는 노트 동기화 한도에 도달했어요. 더 동기화하려면 Team으로 업그레이드하세요. 기존 노트는 계속 동기화되고, 추가 노트는 이 기기에만 남아요." : member
      ? "이 볼트의 멤버 수가 무료 요금제 한도에 도달해서 원격 볼트가 " +
        "거부했어요. 더 추가하려면 업그레이드하세요."
      : "이 계정의 볼트 수가 무료 요금제 한도에 도달해서 원격 볼트가 " +
        "더 만들기를 거부했어요. 계속 동기화하려면 업그레이드하세요.",
    remedies: ["upgrade", "copy-details"],
    code: f.code,
    explanation: {
      meaning: notes ? "이 볼트는 노트 동기화 한도에 도달했어요. 추가한 노트는 이 기기에 안전하게 남아 있어요." : member
        ? "무료 요금제는 한 볼트에 넣을 수 있는 인원이 제한돼요. 이 볼트가 그 한도에 " +
          "도달해서 원격 볼트가 이 요청을 거절했어요. 잃은 것은 없고, " +
          "작업이 입구에서 멈췄을 뿐이에요."
        : "무료 요금제는 계정당 만들 수 있는 볼트 수가 제한돼요. 이 계정이 그 한도에 " +
          "도달해서 원격 볼트가 볼트를 더 만들지 않았어요. 잃은 것은 " +
          "없고, 작업이 입구에서 멈췄을 뿐이에요.",
      next: "할 일 없음. 한도가 풀릴 때까지 원격 볼트는 매번 같은 방식으로 거부해요.",
      fixes: [
        notes ? "더 많은 노트를 동기화하려면 이 볼트를 Team으로 업그레이드하세요." : member
          ? "더 많은 인원을 추가하려면 이 볼트를 업그레이드하세요."
          : "볼트를 더 만들려면 업그레이드하세요.",
        member
          ? "또는 더 이상 함께 일하지 않는 멤버를 제거하면 자리가 생겨요."
          : "또는 쓰지 않는 볼트를 삭제하면 자리가 생겨요.",
      ],
      safety: "only-here",
    },
    facts: [
      ...pathFact(f.path),
      { label: "한도", value: member ? "볼트당 멤버 수" : "계정당 볼트 수" },
      { label: "원격 볼트 코드", value: f.code ?? "알 수 없음", copyable: true },
    ],
    autoRetries: false,
  };
}

/** Key of the vault-wide "registry pull keeps failing" issue. */
export const PULL_FAILED_ISSUE_KEY = "registry-pull-failed";

function registryIssue(f: HealthRegistryFailure, ctx: IssueContext): HealthIssue {
  const key = f.docId ?? f.path;
  if (isLimitCode(f.code)) return limitIssue(f);
  if (f.kind === "pull") {
    return {
      key: PULL_FAILED_ISSUE_KEY,
      docId: null,
      path: null,
      kind: "register-failed",
      severity: "error",
      title: "새 노트와 폴더 변경이 동기화되지 않아요",
      why:
        `앱이 볼트의 파일 목록을 불러올 수 없어요 (마지막 오류: ${f.reason}). ` +
        "기존 노트의 편집은 계속 동기화돼요.",
      remedies: ["copy-details"],
      code: f.code,
      explanation: {
        meaning:
          "새 노트, 새 폴더, 이름 변경, 삭제는 볼트의 파일 목록을 통해 동기화돼요. " +
          "원격 볼트에서 그 목록을 불러오는 데 계속 실패해서 이 변경 사항이 " +
          "이 컴퓨터에서 대기 중이에요. 잃은 것은 없어요.",
        next: "마이 세컨드 브레인은 다음 변경, 재연결, 재시도 때 다시 시도하고 성공하면 이 표시가 사라져요.",
        fixes: [
          "인터넷 연결과 설정 → 연결의 서버 주소를 확인하세요.",
          "계속 생기면 아래 세부 정보를 지원팀에 보내 주세요.",
        ],
        safety: "only-here",
      },
      facts: [
        ...(f.code ? [{ label: "원격 볼트 코드", value: f.code, copyable: true }] : []),
        { label: "마지막 오류", value: f.reason, copyable: true },
      ],
      autoRetries: true,
    };
  }
  if (f.kind === "inbound-blocked" && f.code === "symlink") {
    return {
      key,
      docId: f.docId,
      path: f.path,
      kind: "inbound-blocked",
      severity: "error",
      title: "연결된 경로가 동기화되지 않았어요",
      why: f.reason,
      remedies: ["reveal", "copy-details"],
      code: f.code,
      explanation: {
        meaning:
          "원격 볼트에는 이 경로에 노트가 있지만, 이 컴퓨터에서는 이 경로가 " +
          "심볼릭 링크예요. 마이 세컨드 브레인은 링크를 통해 쓰지 않아서 링크가 가리키는 파일은 그대로 뒀어요.",
        next: "마이 세컨드 브레인은 다음 동기화 때 다시 확인해요.",
        fixes: [
          "실제 파일이 이미 볼트 안에 있다면 링크를 삭제하세요.",
          "또는 링크 대신 실제 파일을 이 경로로 옮기세요.",
        ],
        safety: "on-server",
      },
      facts: [...pathFact(f.path), ...docIdFact(f.docId)],
      autoRetries: true,
    };
  }
  if (f.kind === "inbound-blocked" && f.code === "delete_decision") {
    return {
      key,
      docId: f.docId,
      path: f.path,
      kind: "inbound-blocked",
      severity: "warn",
      title: "디스크에서 삭제돼 복원 중이에요",
      why: "이 노트가 다른 많은 노트와 함께 한꺼번에 볼트 폴더에서 삭제됐어요.",
      remedies: ["copy-details"],
      code: f.code,
      explanation: {
        meaning:
          "마이 세컨드 브레인이 열려 있는 동안 이 폴더에서 많은 노트가 한꺼번에 사라졌어요. 마이 세컨드 브레인은 " +
          "그 변경을 동기화하지 않고 보류했어요. 그래서 노트는 원격 볼트에 그대로 있고 " +
          "팀에서는 아무것도 삭제되지 않았어요.",
        next: "맨 위 알림을 닫거나 알림이 사라지면 이 기기에 다시 돌아와요.",
        fixes: [
          "지금 복원을 선택하면 원격 볼트에서 노트를 바로 되돌려 받아요.",
          "모든 사람에게서 노트를 삭제하려면 마이 세컨드 브레인 안에서 삭제하세요.",
        ],
        safety: "on-server",
      },
      facts: [...pathFact(f.path), ...docIdFact(f.docId)],
      autoRetries: false,
    };
  }
  if (f.kind === "inbound-blocked") {
    return {
      key,
      docId: f.docId,
      path: f.path,
      kind: "inbound-blocked",
      severity: "error",
      title: "안전을 위해 로컬 변경을 보류했어요",
      why: `동기화 안전 점검을 통과하지 못해서 마이 세컨드 브레인이 이 항목을 디스크에 그대로 뒀어요. ${capitalize(f.reason)}`,
      remedies: ["retry", "reveal", "copy-details"],
      code: f.code,
      explanation: {
        meaning: "원격 볼트가 요청한 삭제나 이동을 적용하지 않았어요. 받은 노트를 쓰지 못한 것이 아니라 안전 점검 때문이에요.",
        next: "마이 세컨드 브레인은 다음 동기화 때 다시 확인해요. 필요한 점검을 통과할 때까지 항목이 여기에 남아요.",
        fixes: ["동기화를 다시 시도해 현재 권한과 구조를 확인하세요.", "반복되면 로컬 파일을 지우기 전에 세부 정보를 복사해 조사에 쓰세요."],
        safety: "unknown",
      },
      facts: [...pathFact(f.path), ...docIdFact(f.docId), { label: "안전 점검", value: f.reason, copyable: true }],
      autoRetries: true,
    };
  }
  if (f.kind === "materialize" || f.kind === "inbound") {
    return {
      key,
      docId: f.docId,
      path: f.path,
      kind: "materialize-failed",
      severity: "error",
      title: "디스크에 쓸 수 없어요",
      why:
        `원격 볼트에 이 노트가 있지만 볼트 폴더에 쓸 수 없었어요. ` +
        `${capitalize(f.reason)}`,
      remedies: ["retry", "reveal", "copy-details"],
      code: f.code,
      explanation: {
        meaning:
          "이 노트는 원격 볼트에 안전하게 있어요. 실패한 것은 마지막 단계인 " +
          "이 기기의 볼트 폴더에 쓰는 일이에요. 보통 앱이 쓸 수 없는 폴더, " +
          "운영체제가 받아들이지 않는 파일 이름, 너무 길어진 경로가 원인이에요.",
        next: "마이 세컨드 브레인은 다음 동기화 때 다시 시도해요.",
        fixes: [
          "볼트 폴더에 쓸 수 있는지, 파일을 잠그는 동기화 폴더(일부 클라우드 드라이브) " +
            "안에 있지 않은지 확인하세요.",
          "이름에 이 시스템이 받아들이지 않는 문자가 있다면 다른 기기나 " +
            "원격 볼트에서 노트 이름을 바꾸세요.",
          "폴더 경로가 아주 깊다면 줄이세요.",
        ],
        safety: "on-server",
      },
      facts: [
        ...pathFact(f.path),
        ...docIdFact(f.docId),
        ...(f.code ? [{ label: "원격 볼트 코드", value: f.code, copyable: true }] : []),
        { label: "마지막 오류", value: f.reason, copyable: true },
      ],
      autoRetries: true,
    };
  }
  if (f.kind === "orphan") {
    // `registry.ts` records `orphan` for a file the server has deleted (or
    // revoked) whose content THIS device never confirmed upstream. It is left on
    // disk on purpose — removing it could destroy the only copy — and it stops
    // claiming its path so a later pass can re-register it.
    return {
      key,
      docId: f.docId,
      path: f.path,
      kind: "left-behind",
      severity: "error",
      title: "디스크에만 남고 원격 볼트에는 없어요",
      why:
        `${capitalize(f.reason)} 이 기기에 유일한 사본이 있을 수 있어서 ` +
        `삭제하지 않고 남겨 뒀어요. 열어서 확인한 뒤 필요 없으면 ` +
        `삭제하세요.`,
      remedies: ["open", "reveal", "reregister", "export-copy", "delete", "copy-details"],
      code: f.code,
      explanation: {
        meaning:
          "원격 볼트에 이 노트가 더 이상 없어요. 누군가 삭제했거나 이 노트에 대한 " +
          "권한이 회수됐어요. 보통은 마이 세컨드 브레인이 이 기기의 파일도 지워서 맞추지만, " +
          "이 기기는 원격 볼트가 이 노트의 내용을 받았다는 확인을 받은 적이 없어서 " +
          "지금 보이는 사본이 유일한 사본일 수 있어요. 그래서 삭제하지 않고 " +
          "일부러 남겨 뒀어요.",
        next: "할 일 없음. 마이 세컨드 브레인은 스스로 삭제하거나 다시 업로드하지 않아요.",
        fixes: [
          "열어서 계속 필요한지 판단하세요.",
          "다시 등록으로 원격 볼트에 되돌릴 수 있어요. 이 파일로 새 노트를 " +
            "만들어 업로드해요.",
          "남기되 동기화하지 않으려면 볼트 밖에 사본을 저장하세요.",
          "필요 없다고 확신하면 삭제하세요.",
        ],
        safety: "only-here",
      },
      facts: [
        ...pathFact(f.path),
        ...docIdFact(f.docId),
        ...(f.code ? [{ label: "원격 볼트 코드", value: f.code, copyable: true }] : []),
        { label: "원본 사유", value: f.reason, copyable: true },
      ],
      autoRetries: false,
    };
  }
  const isFolder = f.kind === "folder";
  const what = isFolder ? "폴더" : "노트";
  const coded = registerCodeMeaning(f.code, isFolder ? "folder" : "note");
  const remedies: HealthRemedy[] = isFolder
    ? ["retry", "reveal", "copy-details"]
    : ["retry", "open", "reveal", "copy-details"];
  if (f.code === "no_write_access") remedies.push("contact-owner");
  return {
    key,
    docId: f.docId,
    path: f.path,
    kind: "register-failed",
    severity: "error",
    title: isFolder ? "폴더를 등록할 수 없어요" : "등록할 수 없어요",
    why:
      `원격 볼트에 이 ${what}의 기록이 없어서 그 아래의 어떤 것도 ` +
      `동기화할 수 없어요. ${capitalize(f.reason)}`,
    remedies,
    code: f.code,
    explanation: {
      meaning:
        `동기화하려면 먼저 원격 볼트에 이 ${what}이(가) 있다는 기록이 필요해요. ` +
        `그 기록을 만들지 못해서 이 ${what}(폴더라면 그 안의 모든 것 포함)은 ` +
        `이 기기에만 남아 있어요. ` +
        (coded ??
          (f.code
            ? `원격 볼트의 응답: "${f.code}".`
            : "원격 볼트가 이유를 알려 주지 않았어요.")) +
        (f.code === "no_write_access"
          ? ` ${ownerPhrase(ctx.owner)}에게 편집 권한을 요청하세요.`
          : ""),
      next: "마이 세컨드 브레인은 다음 등록 때 다시 시도해요. 등록은 동기화할 때마다, 폴더가 바뀔 때마다 실행돼요.",
      fixes:
        f.code === "no_write_access"
          ? [
              `${ownerPhrase(ctx.owner)}에게 이 폴더의 편집 권한을 달라고 요청하세요.`,
              "그 전까지는 노트를 쓸 수 있는 폴더로 옮기면 거기서 동기화돼요.",
            ]
          : f.code === "root_frozen"
            ? [`이 ${what}을(를) 볼트 최상위 대신 폴더 안으로 옮기세요.`]
            : f.code === "path_folder_mismatch"
              ? [
                  `${what}을(를) 다른 곳으로 옮겼다가 되돌리면 위치가 다시 기록돼요.`,
                  "계속되면 세부 정보 복사로 신고하세요. 원격 볼트의 두 기록을 맞춰야 해요.",
                ]
              : [
                  "지금 다시 시도하세요.",
                  "온라인 상태인지, 이 볼트에 아직 접근할 수 있는지 확인하세요.",
                ],
      safety: "only-here",
    },
    facts: [
      ...pathFact(f.path),
      ...docIdFact(f.docId),
      ...(f.code ? [{ label: "원격 볼트 코드", value: f.code, copyable: true }] : []),
      { label: "마지막 오류", value: f.reason, copyable: true },
    ],
    autoRetries: true,
  };
}

/** File paths listed on one grouped create-refusal issue; the count says the rest. */
export const MAX_REFUSAL_PATHS_SHOWN = 50;

/** Key of the grouped issue for one (code, folder) — what the banner's Show opens. */
export function createRefusalIssueKey(code: string, folder: string): string {
  return `create-refused:${code}:${folder.toLowerCase()}`;
}

/** Every create refused for the same access reason in one folder, as ONE issue. */
export function createRefusalIssue(g: CreateRefusalGroup, ctx: IssueContext): HealthIssue {
  const n = g.paths.length;
  const what = g.notes === n ? plural(n, "새 노트") : plural(n, "새 항목");
  const where = wherePhrase(g.folder);
  const access = g.code === "no_write_access";
  const shown = g.paths.slice(0, MAX_REFUSAL_PATHS_SHOWN);
  return {
    key: createRefusalIssueKey(g.code, g.folder),
    docId: null,
    path: g.folder === "" ? null : g.folder,
    kind: "register-failed",
    severity: "error",
    title: access
      ? `${what} 동기화 안 됨: ${where} 노트를 추가할 권한이 없어요`
      : `${what} 동기화 안 됨: 이 볼트의 최상위에는 노트를 추가할 수 없어요`,
    why: access
      ? `${where} 노트를 추가할 권한이 없어서 이 노트들은 이 컴퓨터에 남아 있어요. ` +
        "이미 있는 노트의 편집은 계속 동기화돼요."
      : "이 볼트의 최상위는 잠겨 있어서 폴더 안으로 옮길 때까지 이 컴퓨터에 남아 있어요.",
    remedies: access ? ["contact-owner", "copy-details"] : ["copy-details"],
    code: g.code,
    explanation: {
      meaning: access
        ? `새 노트를 동기화하려면 원격 볼트가 받아들여야 해요. ${
            g.folder === "" ? "이 볼트" : "이 폴더"
          }는 읽을 수만 있고 추가할 수는 없어서 원격 볼트가 거절했어요. 잃은 것은 없어요. ` +
          "파일은 이 컴퓨터에 안전하게 있어요."
        : "이 볼트의 최상위는 잠겨 있어서 새 노트는 폴더 안에만 추가할 수 있어요. " +
          "잃은 것은 없어요. 파일은 이 컴퓨터에 안전하게 있어요.",
      next: access
        ? "권한이 바뀌면 바로 알아서 동기화돼요. 마이 세컨드 브레인은 10분마다 다시 확인해요."
        : "폴더 안으로 옮기면 알아서 동기화돼요.",
      fixes: access
        ? [
            `${ownerPhrase(ctx.owner)}에게 ${where} 편집 권한을 달라고 요청하세요.`,
            "또는 이 노트들을 편집할 수 있는 폴더로 옮기세요.",
          ]
        : ["이 노트들을 폴더 안으로 옮기세요."],
      safety: "only-here",
    },
    facts: [
      { label: "폴더", value: g.folder === "" ? "볼트 최상위" : g.folder },
      { label: "동기화 안 됨", value: num(n) },
      ...shown.map((p) => ({ label: "경로", value: p })),
      ...(n > shown.length ? [{ label: "더 있음", value: `${num(n - shown.length)}개 더` }] : []),
      { label: "원격 볼트 코드", value: g.code, copyable: true },
    ],
    autoRetries: access,
  };
}

/** Cap on the `unregistered` warnings emitted. A vault mid-registration can have
 *  thousands; 50 rows say everything 5,000 would, and the total lands in the
 *  report's `detail` instead of in 4,950 DOM nodes. */
export const MAX_UNREGISTERED_ISSUES = 50;

// ── The report ────────────────────────────────────────────────────────────────

function emptyCounts(): HealthCounts {
  return { total: 0, synced: 0, pending: 0, failed: 0, unsynced: 0, unreported: 0 };
}

/**
 * Mirrors `NotSyncingBanner.tsx` `notSyncingReason`'s signed-out half.
 *
 * Duplicated rather than imported: that function lives in a `.tsx` module that
 * imports React, and this one has to stay importable from a Node test with no
 * DOM. The three refusals are the same and must stay in lockstep — a folder that
 * was never a synced vault says nothing, `authStatus: "unknown"` says nothing
 * (it is the window between paint and session restore), and only then is a
 * missing session reported.
 */
function isSignedOutOnSyncedFolder(input: HealthInput): boolean {
  if (input.openFolderIsSynced !== true) return false;
  if (input.authStatus === "unknown") return false;
  return input.authStatus !== "signed-in" || !input.hasSession;
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const serverHost = serverHostOf(input.serverUrl);
  const bulk = isBulkPhase(input.syncProgress?.phase);
  const signedOut = isSignedOutOnSyncedFolder(input);
  const signedIn = input.authStatus === "signed-in" && input.hasSession;

  const index = buildTreeSyncIndex({
    docIdByPath: input.docIdByPath,
    docSyncState: input.docSyncState,
    localNotePaths: input.localNotePaths,
    serverSettled: input.serverSettled === true,
  });
  const v = index.vault;
  const counts: HealthCounts = v
    ? {
        total: v.total,
        synced: v.synced,
        pending: v.pending,
        failed: v.failed,
        unsynced: Math.max(0, v.total - v.synced - v.pending - v.failed),
        unreported: v.unreported,
      }
    : emptyCounts();

  const { issues, unregisteredTotal } = buildIssues(input, {
    bulk,
    signedIn,
    mappedPaths: index.notes,
  });
  const errors = issues.filter((i) => i.severity === "error");

  const verdict = decideVerdict(input, { bulk, signedOut, counts, errors: errors.length });
  const stages = buildStages(input, { verdict, counts, issues, bulk, serverHost });
  const { headline, detail } = describe(input, {
    verdict,
    counts,
    errors: errors.length,
    serverHost,
    unregisteredTotal,
  });

  return {
    verdict,
    headline,
    detail,
    stages,
    counts: input.syncEnabled ? counts : null,
    issues,
    lastSyncedAt: input.lastSyncedAt,
    serverHost: input.syncEnabled ? serverHost : null,
  };
}

/** The vault-level "Sync paused" issue (#252). Exported for tests. */
export function syncPausedIssue(
  pause: { until: number | null; count: number | null } | null,
  heldNotes: number,
  now: number,
): HealthIssue {
  const minutes =
    pause?.until != null && pause.until > now ? Math.max(1, Math.round((pause.until - now) / 60_000)) : null;
  const count = pause?.count ?? null;
  return {
    key: "vault:sync-paused",
    docId: null,
    path: null,
    kind: "sync-paused",
    severity: "warn",
    title: "동기화 일시 중지",
    why:
      (count != null && count > 0
        ? `이 계정에서 노트 ${num(count)}개가 한꺼번에 비워져서 원격 볼트가 동기화를 일시 중지했어요. `
        : "이 계정에서 많은 노트가 한꺼번에 비워져서 원격 볼트가 동기화를 일시 중지했어요. ") +
      "편집 내용은 이 기기에 안전하게 있어요.",
    remedies: ["copy-details"],
    code: "shrink_held",
    explanation: {
      meaning:
        "한 사람의 노트 대부분이 한꺼번에 본문을 잃으면, 무언가 잘못됐을 가능성(스크립트, " +
        "잘못된 동기화, 실수로 비운 폴더)에 대비해 원격 볼트가 잠시 그 사람의 편집을 " +
        "받지 않아요. 본문을 잃은 노트는 모두 먼저 버전으로 저장돼서 " +
        "서버에서 잃은 것은 없어요.",
      next:
        (minutes != null
          ? `약 ${minutes}분 뒤 일시 중지가 저절로 풀려요`
          : "곧 일시 중지가 저절로 풀려요") +
        ". 볼트 소유자나 관리자가 활동에서 풀면 더 빨리 풀려요. 그 후에는 편집 내용이 다른 편집처럼 동기화돼요.",
      fixes: [
        "계속 작업하세요. 일시 중지가 끝날 때까지 바꾼 내용은 이 기기에 남아요.",
        "비워진 노트가 실수였다면 일시 중지가 끝나기 전에 버전 기록에서 복원하세요.",
        "의도한 변경이라면 볼트 소유자나 관리자에게 일시 중지를 풀어 달라고 요청하세요.",
      ],
      safety: "only-here",
    },
    facts: [
      ...(count != null ? [{ label: "비워진 노트", value: num(count) }] : []),
      ...(heldNotes > 0 ? [{ label: "동기화 대기 중인 노트", value: num(heldNotes) }] : []),
      ...(minutes != null ? [{ label: "종료까지", value: `약 ${minutes}분` }] : []),
    ],
    autoRetries: true,
  };
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function decideVerdict(
  input: HealthInput,
  ctx: { bulk: boolean; signedOut: boolean; counts: HealthCounts; errors: number },
): HealthVerdict {
  if (!input.syncEnabled) return "local";
  if (ctx.signedOut) return "signed-out";
  if (input.syncStatus === "no-access") return "no-access";
  // A bulk run outranks the socket statuses, which belong to the OPEN doc and
  // read "offline" whenever no note is on screen — including through the whole
  // of a launch backfill. Work that is demonstrably moving is not offline.
  // (This is the one place the precedence list is reordered, and only here.)
  if (ctx.bulk) return "syncing";
  if (input.syncStatus === "offline") return "offline";
  if (input.syncStatus === "connecting") return "connecting";
  if (ctx.errors > 0 || ctx.counts.failed > 0 || input.syncProgress?.phase === "error") {
    return "attention";
  }
  // Nothing errored, but notes are still not on the server. `healthy` means
  // EVERYTHING confirmed, so this cannot be it — a settled run that left a note
  // behind is precisely the silent divergence this page exists to expose.
  //
  // `unreported` is excluded, and that exclusion is load-bearing: a mapped note
  // nobody has spoken for yet is not work (see `syncRollup.ts`), and counting it
  // would put every fresh launch into `attention` until the first batch of
  // `synced` stamps lands.
  const remaining = ctx.counts.total - ctx.counts.synced - ctx.counts.unreported;
  if (remaining > 0) return "attention";
  return "healthy";
}

// ── Issues ────────────────────────────────────────────────────────────────────

function buildIssues(
  input: HealthInput,
  ctx: { bulk: boolean; signedIn: boolean; mappedPaths: Map<string, DocSyncState> },
): { issues: HealthIssue[]; unregisteredTotal: number } {
  const issues: HealthIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: HealthIssue): void => {
    if (seen.has(issue.key)) return;
    seen.add(issue.key);
    issues.push(issue);
  };
  const owner = ownerOf(input.members);
  const issueCtx: IssueContext = { stats: input.stats, owner };

  // A shrink-brake pause first, as ONE issue: the notes it held are not each
  // broken, they are waiting for the same thing (#252).
  const held = input.failures.content.filter((f) => f.kind === "shrink-held");
  if (input.syncEnabled && (input.syncPause || held.length > 0)) {
    push(syncPausedIssue(input.syncPause ?? null, held.length, input.now));
  }

  // Content first: these are the failures that name a specific note whose only
  // copy is here.
  for (const f of input.failures.content) {
    if (f.kind !== "shrink-held") push(contentIssue(f, issueCtx));
  }
  // Creates refused for access: one issue per (reason, folder) with the file
  // list, not one row per file — a script can strand hundreds in one folder.
  for (const g of groupCreateRefusals(input.failures.registry)) push(createRefusalIssue(g, issueCtx));
  for (const f of input.failures.registry) {
    if ((f.kind === "note" || f.kind === "folder") && isHeldCreateCode(f.code)) continue;
    push(registryIssue(f, issueCtx));
  }

  // A limit that stopped the run but was recorded against nothing the user can
  // see still has to be said once.
  if (isLimitCode(input.failures.limitCode) && !issues.some((i) => i.kind === "limit")) {
    push({
      ...limitIssue({
        kind: "note",
        path: "",
        docId: null,
        reason: "plan limit",
        code: input.failures.limitCode,
      }),
      key: `limit:${input.failures.limitCode}`,
      path: null,
      why: "요금제 한도에서 원격 볼트가 이 동기화를 멈췄어요. 계속하려면 업그레이드하세요.",
    });
  }

  if (input.syncEnabled && ctx.signedIn && input.syncStatus === "no-access") {
    push({
      key: "vault:no-access",
      docId: null,
      path: null,
      kind: "no-access",
      severity: "error",
      title: "이 볼트에 접근할 수 없어요",
      why:
        "원격 볼트가 이 볼트의 동기화 토큰을 거부해서 업로드도 다운로드도 되지 않아요. " +
        "볼트 소유자에게 다시 공유해 달라고 요청하세요.",
      remedies: ["contact-owner", "copy-details"],
      code: null,
      explanation: {
        meaning:
          "모든 노트는 동기화하기 전에 원격 볼트에 권한을 확인하는데, " +
          "원격 볼트가 이 볼트를 거절하고 있어요. 볼트가 접근 불가로 설정됐거나, " +
          "보기 권한이 회수됐거나, " +
          `볼트에서 제거됐을 때 생겨요. 이 상태는 ${ownerPhrase(owner)}만 바꿀 수 있어요.`,
        next: "권한이 주어질 때까지 할 일 없음. 마이 세컨드 브레인이 계속 확인하고, 답이 바뀌는 순간 알아서 재개해요.",
        fixes: [
          `${ownerPhrase(owner)}에게 이 볼트를 다시 공유해 달라고 요청하세요.`,
          "제거될 것을 예상했더라도 로컬 파일은 그대로 있고, 보관하거나 내보낼 수 있어요.",
        ],
        // Deliberately `unknown`: refused access means this device cannot ask
        // the server what it holds, so claiming a copy is (or is not) up there
        // would be a guess.
        safety: "unknown",
      },
      facts: [
        { label: "볼트", value: "원격 볼트가 접근을 거부했어요" },
        ...(owner ? [{ label: "소유자", value: `${owner.name} (${owner.email})`, copyable: true }] : []),
      ],
      autoRetries: true,
    });
  }

  // Notes on disk the registry has never mapped. Only meaningful once the run is
  // NOT in a bulk phase: during registration every unmapped note is simply
  // in-flight, and warning about it would turn a working vault into a wall of
  // alarms for as long as the pass takes.
  //
  // And only once the server has ANSWERED this session. Offline, every unmapped
  // note is unmapped for the same single reason — nobody could register it —
  // so eighteen "Not on the server yet" rows say nothing the verdict's
  // "Offline" does not, and read as eighteen problems. Same rule as the
  // sidebar's dots (`sidebarMarksVisible`).
  let unregisteredTotal = 0;
  const serverAnswered =
    input.syncStatus !== "offline" &&
    input.syncStatus !== "connecting" &&
    input.syncStatus !== "error" &&
    input.syncStatus !== "no-access";
  if (input.syncEnabled && ctx.signedIn && !ctx.bulk && serverAnswered) {
    const failedPaths = new Set<string>([
      ...input.failures.registry.map((f) => f.path),
      ...input.failures.content.map((f) => f.relPath),
    ]);
    for (const path of ctx.mappedPaths.keys()) {
      if (input.docIdByPath[path] !== undefined) continue;
      if (failedPaths.has(path)) continue;
      unregisteredTotal++;
      if (unregisteredTotal > MAX_UNREGISTERED_ISSUES) continue;
      push({
        key: path,
        docId: null,
        path,
        kind: "unregistered",
        severity: "warn",
        title: "아직 원격 볼트에 없어요",
        why:
          "이 노트는 이 기기에만 있어요. 원격 볼트에 기록이 없고, " +
          "실패 보고도 없어요. 동기화가 실행되면 처리될 거예요.",
        remedies: ["retry", "open", "reveal"],
        code: null,
        explanation: {
          meaning:
            "원격 볼트가 아직 이 노트를 몰라요. 오프라인일 때 만든 노트, 방금 마이 세컨드 브레인 " +
            "밖에서 폴더에 추가한 노트, 등록이 다른 노트 뒤에 대기 중인 노트라면 " +
            "정상이에요. 실패한 것은 없고 아직 차례가 오지 않았을 뿐이에요.",
          next: "다음 동기화 때 등록되고, 곧바로 내용이 업로드돼요.",
          fixes: [
            "기다리세요. 연결되면 보통 몇 초 안에 저절로 사라져요.",
            "계속 남아 있다면 지금 다시 시도하세요.",
            "계속 사라지지 않으면 이 페이지의 다른 노트에서 세부 정보 복사를 눌러 신고하세요.",
          ],
          safety: "only-here",
        },
        facts: [{ label: "경로", value: path }],
        autoRetries: true,
      });
    }
  }

  // Leftover edit history (CRDT rows for notes this vault no longer has) is no
  // longer an issue: the sync layer reclaims it on its own once the session is
  // idle (`SyncManager.requestCrdtSweep`). The history stage below still says
  // how much there is.

  for (const issue of linkIssues(input.checks)) push(issue);

  issues.sort(compareIssues);
  return { issues, unregisteredTotal };
}

/**
 * The two link findings of the Rust checks (#216). Sync never follows a
 * symbolic link, so a link is a path the user can see in Finder that 마브
 * treats as absent — a warning. Two mapped notes that resolve to ONE file are
 * worse: each identity egests over the same bytes, so the stale one can
 * overwrite the newer text — an error, one per file.
 */
export function linkIssues(checks: VaultChecks | null | undefined): HealthIssue[] {
  if (!checks) return [];
  const out: HealthIssue[] = [];
  const linked = checks.linkedPaths;
  if (linked && linked.count > 0) {
    const shown = linked.items.map((i) => i.path);
    out.push({
      key: "links:ignored",
      docId: null,
      path: null,
      kind: "linked-paths",
      severity: "warn",
      title: `${plural(linked.count, "연결된 경로")}가 동기화에서 제외됐어요`,
      why: "이 경로들은 심볼릭 링크예요. 마이 세컨드 브레인은 링크를 통해 동기화하지 않아요.",
      remedies: ["copy-details"],
      code: "symlink",
      explanation: {
        meaning:
          "심볼릭 링크는 다른 파일이나 폴더를 가리켜요. 마이 세컨드 브레인은 링크가 아니라 실제 파일이나 " +
          "폴더를 동기화하므로, 링크로만 닿는 항목은 이 기기에만 남아요.",
        next: "할 일 없음. 링크는 항상 건너뛰어요.",
        fixes: [
          "링크 대신 실제 파일이나 폴더를 원하는 위치의 볼트 안으로 옮기세요.",
          "또는 실제 항목이 이미 볼트 안에 있다면 링크를 삭제하세요.",
        ],
        safety: "unknown",
      },
      facts: [
        { label: "링크", value: num(linked.count) },
        ...shown.map((p, i) => ({
          label: "경로",
          value: linked.items[i]?.detail ? `${p} (${linked.items[i].detail})` : p,
        })),
      ],
      autoRetries: false,
    });
  }
  for (const group of checks.sharedFiles ?? []) {
    if (group.paths.length < 2) continue;
    out.push({
      key: `shared:${group.paths.join("|")}`,
      docId: group.docIds[0] ?? null,
      path: group.paths[0],
      kind: "shared-file",
      severity: "error",
      title: "노트 두 개가 디스크의 한 파일을 공유해요",
      why: `${group.paths.join(", ")}은(는) 디스크에서 같은 파일이에요. 보통 심볼릭 링크 때문이에요.`,
      remedies: ["reveal", "copy-details"],
      code: "shared-file",
      explanation: {
        meaning:
          "이 경로들은 마이 세컨드 브레인에서는 각각 별개의 노트지만 이 컴퓨터에서는 하나의 파일이에요. " +
          "한쪽에서 한 편집이 다른 쪽을 덮어쓸 수 있어요.",
        next: "할 일 없음. 마이 세컨드 브레인은 어느 노트가 진짜인지 고르지 않아요.",
        fixes: [
          "심볼릭 링크를 삭제해서 실제 경로만 남기세요.",
          "이후 링크 경로에 노트 사본이 다시 생기면 그 사본을 삭제하세요.",
        ],
        safety: "unknown",
      },
      facts: group.paths.flatMap((p, i) => [
        { label: "경로", value: p },
        ...docIdFact(group.docIds[i] ?? null),
      ]),
      autoRetries: false,
    });
  }
  return out;
}

/** Errors before warnings; within a severity, by path (vault-level issues, which
 *  have no path, sort first because they explain the rest). Total and stable. */
function compareIssues(a: HealthIssue, b: HealthIssue): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  if (a.path === null && b.path !== null) return -1;
  if (a.path !== null && b.path === null) return 1;
  if (a.path !== null && b.path !== null && a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// ── Stages ────────────────────────────────────────────────────────────────────

function buildStages(
  input: HealthInput,
  ctx: {
    verdict: HealthVerdict;
    counts: HealthCounts;
    issues: HealthIssue[];
    bulk: boolean;
    serverHost: string | null;
  },
): HealthStage[] {
  const { verdict, counts, issues, serverHost } = ctx;
  const stats = input.stats;
  const off = !input.syncEnabled;

  // The FIRST stage that explains the verdict carries the error; every later one
  // stays quiet, so the diagram points at one place rather than lighting up.
  const connectionBroken =
    verdict === "signed-out" || verdict === "no-access" || verdict === "offline";
  const hasError = issues.some((i) => i.severity === "error");

  const disk: HealthStage = {
    id: "disk",
    label: "디스크의 파일",
    state: "ok",
    headline: num(stats ? stats.notes.count : counts.total),
    detail: stats
      ? `이 볼트에 ${plural(stats.notes.count, "노트")}, ${plural(stats.folders, "폴더")}, ` +
        `${plural(stats.attachments.count + stats.otherFiles.count, "기타 파일")}이 있어요.`
      : `이 볼트에 ${plural(counts.total, "노트")}가 있어요.`,
  };

  const index: HealthStage = {
    id: "index",
    label: "로컬 인덱스",
    state: "ok",
    headline: stats ? num(stats.notes.count) : "인덱싱됨",
    detail: stats
      ? `${plural(stats.tags, "태그")}, ${plural(stats.links, "링크")}를 인덱싱했어요` +
        (stats.brokenLinks > 0
          ? `. 대상이 없는 ${plural(stats.brokenLinks, "링크")}도 있어요.`
          : ".")
      : "검색과 링크는 로컬 인덱스로 만들어요.",
  };

  const orphanDocs = stats?.history.orphanDocs ?? 0;
  const history: HealthStage = {
    id: "history",
    label: "로컬 기록",
    // Informational only: reclaimed automatically, never something to act on.
    state: "ok",
    headline: stats ? num(stats.history.docs) : "—",
    detail: stats
      ? `이 기기에 ${plural(stats.history.docs, "노트")}의 편집 기록이 저장돼 있어요` +
        (orphanDocs > 0
          ? `. 그중 ${num(orphanDocs)}개는 이 볼트에 더 이상 없는 노트의 기록이에요.`
          : ".")
      : "오프라인 편집이 덮어쓰이지 않고 병합되도록 편집 기록을 로컬에 보관해요.",
  };

  const connection: HealthStage = {
    id: "connection",
    label: "연결",
    state: off
      ? "off"
      : connectionBroken
        ? "error"
        : verdict === "connecting"
          ? "busy"
          : input.syncStatus === "read-only"
            ? "warn"
            : "ok",
    headline: off
      ? "꺼짐"
      : verdict === "signed-out"
        ? "로그아웃됨"
        : verdict === "no-access"
          ? "접근 불가"
          : verdict === "offline"
            ? "오프라인"
            : verdict === "connecting"
              ? "다시 연결하는 중…"
              : input.syncStatus === "read-only"
                ? "보기 전용"
                : "연결됨",
    detail: off
      ? "이 볼트는 원격 볼트에 연결돼 있지 않아요."
      : verdict === "signed-out"
        ? "로그인하면 동기화를 다시 시작해요. 그 전까지 편집 내용은 이 기기에 남아요."
        : verdict === "no-access"
          ? "원격 볼트가 이 볼트의 동기화 토큰을 거부했어요."
          : verdict === "offline"
            ? `지금은 연결할 수 없어요${serverHost ? ` · ${serverHost}` : ""}.`
            : verdict === "connecting"
              ? "연결을 만드는 중이에요."
              : input.syncStatus === "read-only"
                ? "보기 권한만 있어서 편집 내용은 이 기기에 남아요."
                : `${serverHost ? `${serverHost}에 ` : ""}연결됐어요.`,
  };

  const serverState: HealthStageState = off
    ? "off"
    : connectionBroken
      ? "ok" // the connection stage already owns this failure
      : ctx.bulk
        ? "busy"
        : hasError || counts.failed > 0
          ? "error"
          : counts.unreported > 0 || counts.unsynced > 0
            ? "warn"
            : "ok";

  const server: HealthStage = {
    id: "server",
    label: "원격 볼트",
    state: serverState,
    headline: off ? "—" : num(counts.synced),
    detail: off
      ? "원격 볼트에 사본을 두려면 동기화를 켜세요."
      : `${plural(counts.total, "노트")} 중 ${num(counts.synced)}개를 원격 볼트에서 확인했어요` +
        (serverHost ? ` · ${serverHost}` : "") +
        ".",
  };

  return [disk, index, history, connection, server];
}

// ── Headline / detail ─────────────────────────────────────────────────────────

function describe(
  input: HealthInput,
  ctx: {
    verdict: HealthVerdict;
    counts: HealthCounts;
    errors: number;
    serverHost: string | null;
    unregisteredTotal: number;
  },
): { headline: string; detail: string } {
  const { verdict, counts, errors, serverHost } = ctx;
  const behind = Math.max(0, counts.total - counts.synced);
  const where = serverHost ? ` · ${serverHost}` : "";
  const last =
    input.lastSyncedAt != null
      ? `마지막 확인 ${relativeTime(input.lastSyncedAt, input.now)}`
      : "이번 세션에서는 아직 확인된 것이 없어요";
  const overflow =
    ctx.unregisteredTotal > MAX_UNREGISTERED_ISSUES
      ? ` 등록되지 않은 노트 ${num(ctx.unregisteredTotal)}개 중 처음 ${num(MAX_UNREGISTERED_ISSUES)}개를 보여 줘요.`
      : "";

  switch (verdict) {
    case "local":
      return {
        headline: "이 폴더는 동기화가 꺼져 있어요",
        detail:
          `${plural(counts.total, "노트")}가 이 기기에만 있어요. ` +
          `다른 기기와 팀에서 보려면 동기화를 켜세요.`,
      };
    case "signed-out":
      return {
        headline: "로그아웃됨. 동기화되지 않아요",
        detail:
          `이 볼트는 ${serverHost ? serverHost : "원격 볼트"}와 동기화해요. ` +
          `재개하려면 로그인하세요. 그동안 편집 내용은 디스크에 안전하게 있어요.`,
      };
    case "no-access":
      return {
        headline: "이 볼트에 더 이상 접근할 수 없어요",
        detail:
          `원격 볼트가 동기화 토큰을 거부해서 어느 방향으로도 ` +
          `전달되지 않아요. 볼트 소유자에게 다시 공유해 달라고 요청하세요.${where}`,
      };
    case "offline":
      return {
        headline: `오프라인: ${plural(counts.total, "노트")} 중 ${num(counts.synced)}개가 원격 볼트에 있어요`,
        detail: `${last}. 연결이 돌아오면 동기화가 저절로 재개돼요.${where}`,
      };
    case "connecting":
      return {
        headline: "연결 중…",
        detail: `${last}${where}.`,
      };
    case "syncing": {
      const p = input.syncProgress;
      if (p?.phase === "removing") return {
        headline: `권한 업데이트: ${num(Math.max(0, p.total - p.done))}개 남음`,
        detail: "더 이상 접근할 수 없는 로컬 사본을 삭제하는 중이에요.",
      };
      // #258: content the server has never had (an interrupted first upload
      // resuming, or a fresh one) is named as such, because "keep the app open
      // until this reaches zero" is the one thing the reader needs to know.
      const notUploaded = p?.notUploaded ?? 0;
      if (notUploaded > 0) return {
        headline: `업로드 중: ${plural(notUploaded, "노트")}가 아직 업로드되지 않았어요`,
        detail:
          `내용이 도착하기 전까지 팀원에게는 이 노트들이 비어 보여요. 0이 될 때까지 ` +
          `${BRAND_NAME}을(를) 열어 두세요${where}.${overflow}`,
      };
      const of = p && p.total > 0 ? `${num(p.total)}개 중 ${num(p.done)}개` : `${num(behind)}개`;
      return {
        headline: `동기화 중: ${of} 업데이트`,
        detail:
          `${plural(counts.total, "노트")} 중 ${num(counts.synced)}개를 지금까지 확인했어요` +
          `${where}.${overflow}`,
      };
    }
    case "attention":
      return {
        headline:
          behind === 0
            ? `${plural(errors, "항목")}을 확인해 주세요`
            : errors > 0
              ? `${plural(behind, "노트")}가 원격 볼트에 없고, ${num(errors)}개는 확인이 필요해요`
              : `${plural(behind, "노트")}가 원격 볼트에 없어요`,
        detail: `${last}${where}.${overflow}`,
      };
    case "healthy":
    default:
      return {
        headline:
          counts.total === 0
            ? "이 볼트는 비어 있어요"
            : `${plural(counts.total, "노트")} 모두 원격 볼트에 있어요`,
        detail: `${last}${where}.${overflow}`,
      };
  }
}

/**
 * "Where your content is", in words. One sentence per `safety` value, shared by
 * the page and by the text `copyIssue` puts on the clipboard so a bug report and
 * the screen cannot claim different things about the same note.
 */
export function safetyLabel(safety: HealthExplanation["safety"]): string {
  switch (safety) {
    case "only-here":
      return "이 기기에만 있어요. 원격 볼트에 확인된 사본이 없어요.";
    case "on-server":
      return "원격 볼트에 있어요. 이 기기에 쓰는 데 실패했어요.";
    case "both":
      return "이 기기와 원격 볼트에 있어요.";
    case "unknown":
      return "알 수 없어요. 마이 세컨드 브레인이 지금은 사본이 어디에 있는지 확인할 수 없어요.";
  }
}

// ── Per-note inspector ────────────────────────────────────────────────────────

/** Exactly the facts `useVaultHealth.inspectNote` has gathered, in the order the
 *  verdict considers them. Kept pure so the one sentence a user reads about
 *  their own note is unit-tested rather than assembled inside a hook. */
export interface InspectVerdictInput {
  /** Is there a file at this path right now? */
  exists: boolean;
  syncEnabled: boolean;
  /** The Needs-attention row for this note, when it has one. */
  issue: HealthIssue | null;
  permanentFailure: string | null;
  queued: boolean;
  diverged: boolean;
  state: DocSyncState | null;
  /** The registry's durable "the server has this content" checkpoint. */
  pushed: boolean;
  docId: string | null;
}

/**
 * ONE honest sentence about where this note stands.
 *
 * The order is the point. Each check below can be true at the same time as the
 * ones under it, and the first true one is the one that changes what the reader
 * should do — so a note with an issue says so even though it is also "not
 * confirmed", and a note with no file at all never claims a sync state for a
 * file that isn't there. Nothing here says "safe on the server" unless `pushed`
 * or a `synced` report actually said so.
 */
export function composeInspectionVerdict(i: InspectVerdictInput): string {
  if (!i.exists) return "이 경로에는 파일이 없어요.";
  if (!i.syncEnabled) return "이 폴더는 동기화되지 않아서 이 노트는 이 기기에만 있어요.";
  if (i.issue) return `${i.issue.title}. 해야 할 일은 위의 확인 필요 항목을 보세요.`;
  if (i.permanentFailure) {
    return `마이 세컨드 브레인이 이 노트의 동기화를 더 이상 시도하지 않아요: ${capitalize(i.permanentFailure)}`;
  }
  if (i.queued) return "업로드 대기 중이에요. 다음 동기화 대기열에 있어요.";
  if (i.diverged) return "원격 볼트에 아직 없을 수 있는 편집이 있어요. 다음 동기화 때 보내요.";
  if (i.state === "synced" && i.pushed) {
    return "동기화됨. 원격 볼트가 이 노트의 내용을 확인했어요.";
  }
  if (i.pushed && i.state === null) {
    return "원격 볼트에 있어요. 앱을 시작한 뒤로 바뀐 것은 없어요.";
  }
  if (i.docId === null) return "원격 볼트가 아직 이 노트를 몰라요.";
  return "아직 확인되지 않았어요. 이 노트의 내용이 원격 볼트에 저장됐다는 보고가 없어요.";
}
