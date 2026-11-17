/* Vault Settings → Health — the census: what is actually in this vault.
   An activity strip and one "largest" table behind a segmented control. Everything here comes from the Rust census in
   `VaultStats`; nothing is derived from the sync layer, so this whole block is
   just as true for a vault that has never had a server. */
import { useState } from "react";
import type { HistoryFootprint, SizedFile, VaultStats } from "../lib/health/types";
import { activityCellTitle, formatBytes, relativeTime } from "../lib/health/format";
import { buildHeatmap, heatmapRangeLabel } from "../lib/health/heatmapRange";
import { MAX_NOTE_BYTES } from "../lib/sync/contentUpload";
import { AsyncButton } from "./AsyncButton";
import { PathText, type HealthHandlers } from "./HealthShared";

/** Amber before the hard ceiling: a note this size is one paste from being
 *  refused, and the warning is only useful while it can still be acted on. */
const NOTE_WARN_BYTES = 8 * 1024 * 1024;

// ── Activity ──────────────────────────────────────────────────────────────────

/**
 * A calendar of per-day edits: a column per week, a row per weekday.
 *
 * v1 drew twelve rolling seven-day windows as bar heights, which failed the
 * commonest case there is: a vault whose notes were all touched this week
 * rendered eleven invisible stubs beside one full-height block. v2 became a
 * GitHub-style contribution grid, and inherited GitHub's trailing TWELVE
 * MONTHS with it — 52 columns of grey on a vault that is a fortnight old.
 *
 * The window is `heatmapRange.ts` now: last month, this month, and three
 * months of empty days ahead. The forward stretch is the point — it is the
 * space the vault is about to fill, and it keeps today near the middle of the
 * strip instead of jammed against the right edge. Those days carry
 * `data-future` and never take a heat level, so "nothing yet" and "nothing
 * happened" cannot read the same.
 */
export function HealthActivity({
  activity,
  now = Date.now(),
}: {
  activity: VaultStats["activity"];
  /** Fixes which weekday "today" is; injectable for tests. */
  now?: number;
}) {
  const days = activity.days ?? [];
  const grid = buildHeatmap(days, now);
  const caption =
    `최근 7일간 노트 ${activity.modifiedLast7d.toLocaleString()}개 편집 · ` +
    `30일간 ${activity.modifiedLast30d.toLocaleString()}개`;
  // Counted over the DRAWN days, not the whole census: the label describes the
  // strip a reader is looking at.
  const active = grid.cells.filter((c) => !c.future && c.count > 0).length;

  return (
    <div className="health-activity">
      <p className="health-activity-lead">{caption}</p>
      {grid.columns === 0 ? (
        <p className="muted">이 볼트에는 일별 활동 기록이 없어요.</p>
      ) : (
        <div
          className="health-heatmap"
          role="img"
          aria-label={`일별 노트 편집, ${heatmapRangeLabel(grid.range)}: 활동한 날 ${active}일. ${caption}`}
          style={{ ["--heat-cols" as string]: grid.columns }}
        >
          {grid.months.map((m) => (
            <span
              key={`${m.label}-${m.col}`}
              className="health-heat-month"
              style={{ gridColumn: m.col + 2, gridRow: 1 }}
              aria-hidden="true"
            >
              {m.label}
            </span>
          ))}
          <span className="health-heat-day" style={{ gridRow: 3 }} aria-hidden="true">
            월
          </span>
          <span className="health-heat-day" style={{ gridRow: 5 }} aria-hidden="true">
            수
          </span>
          <span className="health-heat-day" style={{ gridRow: 7 }} aria-hidden="true">
            금
          </span>
          {grid.cells.map((c) => (
            <span
              key={c.date}
              className="health-heatcell"
              // A future day gets no `data-level` at all: the shade scale means
              // "this many edits", and 0 there would claim a quiet day.
              data-level={c.future ? undefined : c.level}
              data-future={c.future ? "" : undefined}
              data-today={c.today ? "" : undefined}
              style={{ gridColumn: c.col + 2, gridRow: c.row + 2 }}
              title={activityCellTitle(c)}
            />
          ))}
          <div className="health-heatmap-legend" aria-hidden="true">
            <span>적음</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className="health-heatcell" data-level={l} />
            ))}
            <span>많음</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Largest ───────────────────────────────────────────────────────────────────

function sizeBadge(bytes: number): "bad" | "warn" | null {
  if (bytes >= MAX_NOTE_BYTES) return "bad";
  if (bytes >= NOTE_WARN_BYTES) return "warn";
  return null;
}

function fileName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut >= 0 ? path.slice(cut + 1) : path;
}

type Pane = "notes" | "files" | "history";

export function HealthLargest({
  stats,
  handlers,
}: {
  stats: VaultStats;
  handlers: HealthHandlers;
}) {
  const [pane, setPane] = useState<Pane>("notes");
  const panes: Array<[Pane, string, number]> = [
    ["notes", "노트", stats.largestNotes.length],
    ["files", "파일", stats.largestFiles.length],
    ["history", "기록", stats.heaviestHistory.length],
  ];

  return (
    <div className="health-largest">
      <div className="segmented health-segmented" role="tablist" aria-label="종류별 가장 큰 항목">
        {panes.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            className={pane === id ? "active" : ""}
            onClick={() => setPane(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {pane === "history" ? (
        <HistoryTable stats={stats} handlers={handlers} />
      ) : (
        <FileTable
          rows={pane === "notes" ? stats.largestNotes : stats.largestFiles}
          empty={pane === "notes" ? "아직 노트가 없어요." : "첨부 파일이나 다른 파일이 없어요."}
          openable={pane === "notes"}
          handlers={handlers}
        />
      )}
    </div>
  );
}

function FileTable({
  rows,
  empty,
  openable,
  handlers,
}: {
  rows: SizedFile[];
  empty: string;
  openable: boolean;
  handlers: HealthHandlers;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="health-table">
      <thead>
        <tr>
          <th scope="col">이름</th>
          <th scope="col" className="health-num">
            크기
          </th>
          <th scope="col" className="health-num health-modified">
            수정함
          </th>
          <th scope="col" aria-label="작업" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const badge = sizeBadge(row.bytes);
          return (
            <tr key={row.path}>
              <td>
                <span className="health-file-name">{fileName(row.path)}</span>
                <PathText path={row.path} />
              </td>
              <td className="health-num" data-tone={badge ?? undefined}>
                {formatBytes(row.bytes)}
                {badge && (
                  <span className="health-size-badge">
                    {badge === "bad" ? "한도 초과" : "한도 근접"}
                  </span>
                )}
              </td>
              <td className="health-num health-modified">
                {relativeTime(row.mtime, handlers.now)}
              </td>
              <td className="health-row-actions">
                {openable && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => handlers.openNote(row.path)}
                  >
                    열기
                  </button>
                )}
                <AsyncButton
                  className="link-btn"
                  onClick={() => handlers.actions.reveal(row.path)}
                >
                  위치 보기
                </AsyncButton>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HistoryTable({
  stats,
  handlers,
}: {
  stats: VaultStats;
  handlers: HealthHandlers;
}) {
  if (stats.heaviestHistory.length === 0) {
    return <p className="muted">아직 로컬 편집 기록이 없어요.</p>;
  }
  return (
    <table className="health-table">
      <thead>
        <tr>
          <th scope="col">노트</th>
          <th scope="col" className="health-num">
            업데이트
          </th>
          <th scope="col" className="health-num">
            크기
          </th>
          <th scope="col" aria-label="작업" />
        </tr>
      </thead>
      <tbody>
        {stats.heaviestHistory.map((row: HistoryFootprint) => (
          <tr key={row.docId}>
            <td>
              {row.path ? (
                <PathText path={row.path} />
              ) : (
                <span className="muted">고아 항목 · {row.docId.slice(0, 8)}</span>
              )}
            </td>
            <td className="health-num">{row.updates.toLocaleString()}</td>
            <td className="health-num">{formatBytes(row.bytes)}</td>
            <td className="health-row-actions">
              {row.path && (
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() =>
                    handlers.confirm({ kind: "reset", docId: row.docId, path: row.path })
                  }
                >
                  기록 초기화
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
