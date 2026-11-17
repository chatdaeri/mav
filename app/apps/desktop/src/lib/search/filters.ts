/**
 * Search query syntax → plain text + structured filters for Rust.
 *
 *   ext:pdf,hwpx  path:콘텐츠/  after:2026-11-01  before:2026-11-17  kind:file|note
 *
 * Dates are local calendar days; `before` includes the named day, so Rust
 * receives the start of the NEXT day as its exclusive bound.
 */
export type SearchKind = "note" | "file";

export interface SearchFilters {
  exts: string[];
  path?: string;
  /** Unix seconds, inclusive. */
  after?: number;
  /** Unix seconds, exclusive. */
  before?: number;
  kind?: SearchKind;
}

export interface ParsedSearch {
  text: string;
  filters: SearchFilters;
}

const DAY = 86_400;

function dayStart(s: string): number | undefined {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return undefined;
  return Math.floor(d.getTime() / 1000);
}

export function parseSearch(input: string): ParsedSearch {
  const filters: SearchFilters = { exts: [] };
  const text: string[] = [];
  for (const tok of input.split(/\s+/).filter(Boolean)) {
    const m = /^(ext|path|after|before|kind):(.*)$/i.exec(tok);
    if (!m || !m[2]) {
      text.push(tok);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === "ext") {
      for (const e of val.split(",")) {
        const x = e.replace(/^\./, "").toLowerCase();
        if (x && !filters.exts.includes(x)) filters.exts.push(x);
      }
    } else if (key === "path") {
      filters.path = val.replace(/^\/+|\/+$/g, "");
    } else if (key === "after") {
      const t = dayStart(val);
      if (t === undefined) text.push(tok);
      else filters.after = t;
    } else if (key === "before") {
      const t = dayStart(val);
      if (t === undefined) text.push(tok);
      else filters.before = t + DAY;
    } else {
      const k = val.toLowerCase();
      if (k === "note" || k === "file") filters.kind = k;
      else text.push(tok);
    }
  }
  return { text: text.join(" "), filters };
}

export function hasFilters(f: SearchFilters): boolean {
  return f.exts.length > 0 || !!f.path || f.after !== undefined || f.before !== undefined || !!f.kind;
}

/** Merge chip state over syntax state; chips win where both are set. */
export function mergeFilters(a: SearchFilters, b: Partial<SearchFilters>): SearchFilters {
  return {
    exts: [...new Set([...a.exts, ...(b.exts ?? [])])],
    path: b.path ?? a.path,
    after: b.after ?? a.after,
    before: b.before ?? a.before,
    kind: b.kind ?? a.kind,
  };
}

export type DatePreset = "today" | "7d" | "30d";

/** Start of the preset's window (local midnight), as Unix seconds. */
export function presetAfter(p: DatePreset, now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (p === "today" ? 0 : p === "7d" ? 6 : 29));
  return Math.floor(start.getTime() / 1000);
}
