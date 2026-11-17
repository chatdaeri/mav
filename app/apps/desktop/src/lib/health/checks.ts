// The integrity checks the Health page shows, in the order they appear.
//
// Rust (`src-tauri/src/checks.rs`, `ipc.vaultChecks`) only reports counts and
// the affected files per `VaultCheckId`; everything a person reads about a check
// lives here, so the wording can be reviewed in one place and a new check is one
// Rust arm plus one row below.
//
// Pure data + two pure helpers, so it is unit-tested without React.

import type { VaultCheckId, VaultCheckResult, VaultChecks } from "./types";

/** How loudly a FAILING check should read. `info` is housekeeping, not a fault. */
export type CheckSeverity = "info" | "warn" | "error";

/**
 * Which of the page's actions make sense on this check's items / as a whole.
 *
 * The first five are PER ITEM (a button on one row); the rest act on the whole
 * check. An action whose name ends in `-all` is the bulk form of the per-item
 * action above it and reaches exactly the items the row LISTS, never the ones
 * the count implies but Rust capped away.
 */
export type CheckAction =
  // per item
  | "open"
  | "reveal"
  | "delete"
  | "export-copy"
  | "reset-history"
  // the whole check
  | "delete-all"
  | "export-all"
  | "reset-history-all"
  | "rename-legal"
  | "reclaim"
  | "empty-trash"
  | "rebuild-index"
  | "sync-now";

/**
 * Every word a bulk or heal button says, in one table.
 *
 * `{n}` is the number of items the action will touch and `{check}` the check's
 * own label; `planCheckAction` (lib/health/checkActions.ts) substitutes both.
 * Wording lives HERE, with the check definitions, so a reviewer reads what the
 * page will say without opening a component.
 */
export interface CheckActionWording {
  /** Button label. */
  label: string;
  /** Past tense, for the result line: "Deleted 12 of 12". */
  verb: string;
  /** Present participle, for the progress line: "Deleting 3 of 12…". */
  gerund: string;
  /** Present when the action must be confirmed before it runs. */
  confirm?: {
    title: string;
    body: string;
    confirmLabel: string;
    tone: "danger" | "accent";
  };
}

export const CHECK_ACTIONS: Record<CheckAction, CheckActionWording> = {
  open: { label: "열기", verb: "열었음", gerund: "여는 중" },
  reveal: { label: "위치 보기", verb: "표시함", gerund: "표시하는 중" },
  delete: { label: "삭제", verb: "삭제함", gerund: "삭제하는 중" },
  "export-copy": { label: "사본 저장", verb: "저장함", gerund: "저장하는 중" },
  "reset-history": { label: "기록 초기화", verb: "초기화함", gerund: "초기화하는 중" },

  "delete-all": {
    label: "모두 삭제",
    verb: "삭제함",
    gerund: "삭제하는 중",
    confirm: {
      title: "{check} {n}개를 삭제할까요?",
      body:
        "이 볼트와 동기화하는 모든 기기에서 삭제돼요. 사이드바에서 삭제하는 것과 " +
        "같은 삭제예요. 볼트 체크포인트로 되돌릴 수 있어요.",
      confirmLabel: "모두 삭제",
      tone: "danger",
    },
  },
  "export-all": {
    label: "사본 저장",
    verb: "저장함",
    gerund: "저장하는 중",
  },
  "reset-history-all": {
    label: "기록 초기화",
    verb: "초기화함",
    gerund: "초기화하는 중",
    confirm: {
      title: "노트 {n}개의 기록을 초기화할까요?",
      body:
        "각 노트가 디스크에 있는 파일에서 다시 시작해요. 지금 있는 텍스트는 유지되지만, " +
        "그 뒤의 편집 기록은 모든 기기에서 삭제되고 실행 취소로 이 시점 이전으로 " +
        "돌아갈 수 없어요.",
      confirmLabel: "기록 초기화",
      tone: "danger",
    },
  },
  "rename-legal": {
    label: "사용 가능한 이름으로 바꾸기",
    verb: "이름 바꿈",
    gerund: "이름 바꾸는 중",
    confirm: {
      title: "파일 {n}개의 이름을 바꿀까요?",
      body:
        "문제가 되는 문자는 `-`로 바뀌고, 끝의 점이나 공백은 사라지며, " +
        "Windows 예약어는 앞에 `_`가 붙어요. 파일의 식별 정보와 기록, 위치는 그대로라서 " +
        "새 노트가 아니라 이름 변경이지만, 예전 이름을 쓴 " +
        "[[위키링크]]는 직접 고쳐야 해요. 폴더는 그대로 둬요.",
      confirmLabel: "이름 바꾸기",
      tone: "accent",
    },
  },
  reclaim: { label: "공간 확보", verb: "확보함", gerund: "확보하는 중" },
  "empty-trash": {
    label: "휴지통 비우기",
    verb: "제거함",
    gerund: "비우는 중",
    confirm: {
      title: "복구 사본을 비울까요?",
      body:
        "이 파일에는 동기화하지 못한 로컬 편집 내용과 이전 버전이 보관한 삭제된 노트 사본이 " +
        "들어 있을 수 있어요. 비우면 영구 삭제돼요. 볼트에 있는 노트는 그대로예요.",
      confirmLabel: "휴지통 비우기",
      tone: "danger",
    },
  },
  "rebuild-index": {
    label: "색인 다시 만들기",
    verb: "다시 만듦",
    gerund: "다시 만드는 중",
  },
  "sync-now": { label: "지금 동기화", verb: "동기화함", gerund: "동기화하는 중" },
};

/**
 * Actions that act on the vault as a whole rather than on the listed items, so
 * "12 of 12" would be meaningless for them and a capped item list costs them
 * nothing.
 */
export const WHOLE_VAULT_ACTIONS: ReadonlySet<CheckAction> = new Set<CheckAction>([
  "reclaim",
  "empty-trash",
  "rebuild-index",
  "sync-now",
]);

export interface CheckDefinition {
  id: VaultCheckId;
  /** Section the check is grouped under. */
  group: "files" | "names" | "links" | "storage";
  label: string;
  /** What the check looks for — shown when it passes too, so a green row still
   *  tells you what was verified. */
  looksFor: string;
  /** Why it matters when it fails, in the user's terms. One or two sentences. */
  whyItMatters: string;
  /** What to do about it. Prose, best first. */
  howToFix: string[];
  severity: CheckSeverity;
  /** Per-item actions, in order. */
  itemActions: CheckAction[];
  /**
   * The ONE action that makes the finding go away by itself — mechanical, safe
   * to run without reading the list first. It is the row's primary button and
   * reads as "Heal"; everything else waits in `bulkActions`.
   *
   * A check with no `heal` is one where the right fix is a judgement call
   * (which of two colliding names is wrong? what should a 240-character path
   * be shortened TO?) or where the data is simply gone (a missing image). Those
   * keep their instructions, deliberately: a heal that guesses is worse than a
   * sentence that explains.
   */
  heal?: CheckAction;
  /** Bulk forms of the per-item actions, in order, as buttons in the row header. */
  bulkActions?: CheckAction[];
  /** The check reports a byte total worth showing next to the count. */
  showsBytes?: boolean;
}

export const CHECK_DEFINITIONS: CheckDefinition[] = [
  // ── Files ────────────────────────────────────────────────────────────────
  {
    id: "empty-notes",
    group: "files",
    label: "빈 노트",
    looksFor: "파일 크기가 0바이트인 노트예요.",
    whyItMatters:
      "빈 노트는 동기화에는 문제가 없지만, 예전에 내용이 있었는데 지금 비어 있다면 " +
      "저장이 반영되지 않았거나 다른 앱이 파일을 잘라낸 경우가 많아요.",
    howToFix: [
      "노트를 열어 보세요. 내용이 있어야 한다면 버전 기록에서 복원하세요.",
      "채우지 않은 노트는 삭제하세요. '모두 삭제'를 누르면 여기 나열된 노트를 한 번에 지워요.",
    ],
    severity: "info",
    itemActions: ["open", "reveal", "delete"],
    bulkActions: ["delete-all"],
  },
  {
    id: "unreadable-notes",
    group: "files",
    label: "읽을 수 없는 노트",
    looksFor: "올바른 텍스트가 아닌 노트 파일이에요 (UTF-8이 아니거나 바이너리).",
    whyItMatters:
      "마이 세컨드 브레인은 텍스트로 읽을 수 없는 노트를 열거나 색인하거나 동기화할 수 없어요. 이런 파일은 " +
      "다른 곳에서는 조용히 건너뛰므로 여기에서만 볼 수 있어요.",
    howToFix: [
      "텍스트 편집기에서 파일을 열어 UTF-8로 저장하세요.",
      "실제로는 노트가 아니라면(이름만 .md인 이미지나 내보내기 파일) 볼트 밖으로 옮기거나 이름을 바꾸세요.",
      "'사본 저장'을 누르면 삭제하기 전에 모든 파일을 볼트 밖의 한 폴더에 모아 저장해요.",
    ],
    severity: "error",
    itemActions: ["reveal", "export-copy", "delete"],
    bulkActions: ["export-all", "delete-all"],
  },
  {
    id: "bad-frontmatter",
    group: "files",
    label: "깨진 속성 블록",
    looksFor:
      "---로 시작하지만 속성 블록이 닫히지 않았거나, key: value 형식이 아닌 줄이 있는 노트예요.",
    whyItMatters:
      "마이 세컨드 브레인이 읽을 수 없는 속성은 일반 텍스트로 표시되고 절대 수정되지 않아서 잃는 것은 없지만, " +
      "그 블록의 태그와 날짜는 검색이나 필터에서 찾을 수 없어요.",
    howToFix: [
      "노트를 열고 ---만 있는 줄로 블록을 닫으세요.",
      "속성은 한 줄에 하나씩 key: value 형식으로 쓰세요.",
      "마이 세컨드 브레인은 이 문제를 대신 고치지 않아요. 읽을 수 없는 속성은 절대 다시 쓰지 않는데, " +
        "의도를 짐작해서 고치면 모르는 사이에 데이터가 바뀔 수 있기 때문이에요.",
    ],
    severity: "warn",
    itemActions: ["open", "reveal"],
  },
  {
    id: "oversized-notes",
    group: "files",
    label: "크기 제한을 넘은 노트",
    looksFor: "10MB 이상인 노트예요. 원격 볼트가 노트 하나에 받을 수 있는 최대 크기예요.",
    whyItMatters:
      "이 크기의 노트는 업로드할 수 없어서 유일한 사본이 이 기기에만 있어요. 큰 노트는 " +
      "대부분 붙여 넣은 이미지나 데이터 표 때문이에요.",
    howToFix: [
      "큰 이미지와 파일은 첨부 파일로 옮기고 링크로 연결하세요.",
      "노트를 나누거나, 볼트 밖에 사본을 저장한 뒤 줄이세요. '사본 저장'을 누르면 " +
        "모든 노트를 한 번에 한 폴더에 저장해요.",
    ],
    severity: "error",
    itemActions: ["open", "reveal", "export-copy"],
    bulkActions: ["export-all"],
    showsBytes: true,
  },
  {
    id: "stale-index",
    group: "files",
    label: "검색 색인이 오래됨",
    looksFor: "마지막으로 색인한 뒤 디스크에서 바뀌었거나 파일이 사라진 노트예요.",
    whyItMatters:
      "검색, 태그, 백링크, 그래프는 색인을 읽기 때문에 오래된 항목이 있으면 최근 편집이 " +
      "빠지거나 이미 없는 파일을 가리키는 결과가 나와요.",
    howToFix: [
      "자동 고치기는 색인을 다시 만들어요. 모든 노트를 다시 읽으며 몇 초 걸려요.",
    ],
    severity: "warn",
    itemActions: ["open", "reveal"],
    heal: "rebuild-index",
  },
  {
    id: "unindexed-markdown",
    group: "files",
    label: "인식되지 않은 Markdown",
    looksFor: "디스크에는 있지만 색인에 없는 Markdown 파일이에요.",
    whyItMatters:
      "색인이 한 번도 보지 못한 파일은 검색에 나타나지 않고 동기화되지도 않아요. 보통 " +
      "마이 세컨드 브레인이 꺼져 있는 동안 복사해 넣은 파일이에요.",
    howToFix: [
      "자동 고치기가 색인을 다시 만들어 이 파일들이 노트가 돼요.",
      "그다음 '지금 동기화'를 누르면 원격 볼트에 등록돼요.",
    ],
    severity: "warn",
    itemActions: ["reveal"],
    heal: "rebuild-index",
    bulkActions: ["sync-now"],
  },

  // ── Names & paths ────────────────────────────────────────────────────────
  {
    id: "case-collisions",
    group: "names",
    label: "대소문자만 다른 이름",
    looksFor: "대소문자를 무시하면 같아지는 두 경로예요.",
    whyItMatters:
      "Mac이나 Windows에서는 하나의 파일이지만, 원격 볼트와 Linux에서는 두 파일이에요. " +
      "이 불일치가 노트가 계속 다시 동기화되는 가장 흔한 원인이에요.",
    howToFix: [
      "둘 중 하나의 이름을 바꿔서 대소문자 외에도 다르게 만드세요.",
      "마이 세컨드 브레인은 대신 고르지 않아요. 두 이름 중 어느 쪽이 맞는지는 직접 아는 사람만 알고, " +
        "잘못된 쪽을 바꾸면 링크가 가리키던 노트가 옮겨져요.",
    ],
    severity: "error",
    itemActions: ["reveal"],
  },
  {
    id: "illegal-names",
    group: "names",
    label: "Windows에서 쓸 수 없는 이름",
    looksFor:
      '< > : " | ? * 가 들어 있거나, 점이나 공백으로 끝나거나, CON·NUL 같은 예약어인 이름이에요.',
    whyItMatters:
      "Windows를 쓰는 팀원은 이 파일을 만들 수 없어서 그 사람의 볼트에는 조용히 빠져요.",
    howToFix: [
      "자동 고치기는 여기 나열된 모든 파일의 이름에서 문제가 되는 문자를 " +
        "없애요(`-`로 바뀌고, 끝의 점이나 공백은 사라지며, Windows 예약어는 앞에 `_`가 " +
        "붙어요). 노트의 식별 정보와 기록은 그대로예요.",
      "폴더는 직접 고쳐야 해요. 폴더 이름을 바꾸면 안에 있는 모든 항목이 함께 옮겨지기 때문이에요.",
      "예전 이름을 쓴 위키링크는 나중에 직접 고쳐야 해요.",
    ],
    severity: "warn",
    itemActions: ["reveal"],
    heal: "rename-legal",
  },
  {
    id: "long-paths",
    group: "names",
    label: "너무 긴 경로",
    looksFor: "볼트 루트부터 200자를 넘는 경로예요.",
    whyItMatters: "Windows와 일부 백업 도구는 전체 260자를 넘는 경로를 처리하지 못해요.",
    howToFix: [
      "폴더나 파일 이름을 줄이세요.",
      "마이 세컨드 브레인은 대신 줄이지 않아요. 기계가 잘라낸 이름은 " +
        "노트가 무엇인지 알려 주지 못하기 때문이에요.",
    ],
    severity: "info",
    itemActions: ["reveal"],
  },
  {
    id: "duplicate-titles",
    group: "names",
    label: "제목이 같은 노트",
    looksFor: "제목이 같은 노트가 둘 이상 있어요.",
    whyItMatters:
      "그 제목으로 연결한 [[위키링크]]가 모호해서 의도와 다른 노트가 열릴 수 있어요.",
    howToFix: [
      "하나의 제목을 더 구체적으로 바꾸거나, 경로로 연결하세요.",
      "망가진 것은 없어서 마이 세컨드 브레인은 제목을 직접 바꾸지 않아요. 둘 중 " +
        "어느 쪽을 바꿀지는 직접 정하세요.",
    ],
    severity: "info",
    itemActions: ["open", "reveal"],
  },

  // ── Links ────────────────────────────────────────────────────────────────
  {
    id: "broken-links",
    group: "links",
    label: "없는 노트로 가는 링크",
    looksFor: "볼트에 없는 노트를 가리키는 [[위키링크]]예요.",
    whyItMatters: "클릭하면 의도한 노트가 열리는 대신 새 빈 노트가 만들어져요.",
    howToFix: [
      "링크가 오타라면 원본 노트를 열어 링크를 고치세요.",
      "의도한 링크라면 원하는 이름과 위치로 직접 노트를 만드세요.",
    ],
    severity: "info",
    itemActions: ["open"],
  },
  {
    id: "missing-embeds",
    group: "links",
    label: "없는 이미지와 첨부 파일",
    looksFor: "파일이 볼트에 없는 ![[임베드]]와 ![](이미지)예요.",
    whyItMatters:
      "노트에 깨진 이미지가 표시돼요. 보통 파일을 복사해 넣지 않았거나, 노트가 아직 쓰고 있는데 " +
      "첨부 파일에서 삭제된 경우예요.",
    howToFix: [
      "파일을 다시 노트에 넣거나 임베드를 지우세요.",
      "마이 세컨드 브레인이 이 문제는 고칠 수 없어요. 파일 데이터가 볼트에 없어서 " +
        "임베드가 가리킬 대상이 없기 때문이에요.",
    ],
    severity: "warn",
    itemActions: ["open"],
  },

  // ── Storage ──────────────────────────────────────────────────────────────
  {
    id: "heavy-history",
    group: "storage",
    label: "편집 기록이 큰 노트",
    looksFor: "로컬 편집 기록이 노트 자체보다 몇 배나 큰 노트예요.",
    whyItMatters:
      "기록이 이렇게 크면 노트를 열고 동기화하는 속도가 느려지고, 텍스트가 작아도 원격 볼트의 " +
      "한도를 넘을 수 있어요.",
    howToFix: [
      "노트의 기록을 초기화하세요. 텍스트는 유지되고 모든 기기에서 새 기록이 시작돼요.",
      "자동 고치기는 여기 나열된 모든 노트에 한 번에 이 작업을 해요.",
    ],
    severity: "warn",
    itemActions: ["open", "reset-history"],
    heal: "reset-history-all",
    showsBytes: true,
  },
  {
    id: "orphan-history",
    group: "storage",
    label: "남은 편집 기록",
    looksFor: "이 볼트에 더 이상 없는 노트의 편집 기록이에요.",
    whyItMatters: "공간만 차지해요. 눈에 보이는 것 중 이 기록에 의존하는 것은 없어요.",
    howToFix: ["자동 고치기로 공간을 확보하세요. 눈에 보이는 것은 바뀌지 않아요."],
    severity: "info",
    itemActions: [],
    heal: "reclaim",
    showsBytes: true,
  },
  {
    id: "trash",
    group: "storage",
    label: "복구 사본",
    looksFor:
      "마이 세컨드 브레인이 보존한 보내지 못한 로컬 편집 내용과, 이전 버전이 보관한 삭제된 노트 사본이에요.",
    whyItMatters:
      "동기화하지 못한 변경 사항이 들어 있을 수 있고, 비우기 전까지 공간을 차지해요.",
    howToFix: ["사본을 확인한 뒤 더 이상 필요 없다고 확신할 때 비우세요."],
    severity: "info",
    itemActions: ["reveal"],
    bulkActions: ["empty-trash"],
    showsBytes: true,
  },
];

export const CHECK_BY_ID: ReadonlyMap<VaultCheckId, CheckDefinition> = new Map(
  CHECK_DEFINITIONS.map((d) => [d.id, d]),
);

export const CHECK_GROUP_LABELS: Record<CheckDefinition["group"], string> = {
  files: "파일",
  names: "이름과 경로",
  links: "링크",
  storage: "저장 공간",
};

/**
 * Checks the app resolves on its own, so they are never listed. Leftover edit
 * history is swept automatically while sync is idle (`requestCrdtSweep`); the
 * definition stays so the check action it names keeps its wording.
 */
export const AUTOMATIC_CHECK_IDS: ReadonlySet<VaultCheckId> = new Set<VaultCheckId>(["orphan-history"]);

/** Drop the results of {@link AUTOMATIC_CHECK_IDS} before anything renders or
 *  reports them: the Health list, its summary and the assistant's evidence. */
export function withoutAutomaticChecks(checks: VaultChecks): VaultChecks {
  return { ...checks, results: checks.results.filter((r) => !AUTOMATIC_CHECK_IDS.has(r.id)) };
}

/** One check joined to its result, ready to render. */
export interface CheckRow {
  def: CheckDefinition;
  result: VaultCheckResult;
  passed: boolean;
}

/**
 * Join definitions to results in definition order. A result Rust did not send
 * (older binary) renders as passed-with-zero rather than vanishing, so the list
 * always has the same rows and a missing check is visible as "0", not absent.
 */
export function checkRows(checks: VaultChecks | null): CheckRow[] {
  const byId = new Map(checks?.results.map((r) => [r.id, r]) ?? []);
  return CHECK_DEFINITIONS.filter((def) => !AUTOMATIC_CHECK_IDS.has(def.id)).map((def) => {
    const result = byId.get(def.id) ?? { id: def.id, count: 0, items: [] };
    return { def, result, passed: result.count === 0 };
  });
}

export interface CheckSummary {
  total: number;
  passed: number;
  /** Failing checks by their severity. */
  errors: number;
  warnings: number;
  infos: number;
  /** "All 15 checks passed" / "2 checks need a look · 1 is housekeeping". */
  headline: string;
}

export function summarizeChecks(rows: CheckRow[]): CheckSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const r of rows) {
    if (r.passed) continue;
    if (r.def.severity === "error") errors++;
    else if (r.def.severity === "warn") warnings++;
    else infos++;
  }
  const passed = rows.length - errors - warnings - infos;
  const attention = errors + warnings;
  let headline: string;
  if (attention === 0 && infos === 0) headline = `점검 ${rows.length}개를 모두 통과했어요`;
  else if (attention === 0) {
    headline = `점검 ${rows.length}개 중 ${passed}개 통과 · 정리 ${infos}개`;
  } else {
    headline =
      `확인이 필요한 점검 ${attention}개` +
      (infos > 0 ? ` · 정리 ${infos}개` : "");
  }
  return { total: rows.length, passed, errors, warnings, infos, headline };
}
