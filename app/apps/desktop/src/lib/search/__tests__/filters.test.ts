import { describe, expect, it } from "vitest";
import { hasFilters, mergeFilters, parseSearch, presetAfter } from "../filters";

describe("parseSearch", () => {
  it("splits text from filter tokens", () => {
    const r = parseSearch("강의 ext:pdf,.HWPX path:/콘텐츠/ kind:file 대본");
    expect(r.text).toBe("강의 대본");
    expect(r.filters).toEqual({ exts: ["pdf", "hwpx"], path: "콘텐츠", kind: "file" });
  });

  it("turns dates into a local-day window with an inclusive before", () => {
    const r = parseSearch("after:2026-11-01 before:2026-11-17");
    expect(r.filters.after).toBe(new Date(2026, 10, 1).getTime() / 1000);
    expect(r.filters.before).toBe(new Date(2026, 10, 18).getTime() / 1000);
  });

  it("keeps malformed tokens as text", () => {
    const r = parseSearch("after:어제 kind:폴더 ext:");
    expect(r.text).toBe("after:어제 kind:폴더 ext:");
    expect(hasFilters(r.filters)).toBe(false);
  });

  it("merges chip state over syntax", () => {
    const m = mergeFilters({ exts: ["pdf"], kind: "note" }, { exts: ["pdf", "md"], kind: "file" });
    expect(m).toEqual({ exts: ["pdf", "md"], path: undefined, after: undefined, before: undefined, kind: "file" });
  });

  it("computes preset windows from local midnight", () => {
    const now = new Date(2026, 10, 17, 15, 30);
    expect(presetAfter("today", now)).toBe(new Date(2026, 10, 17).getTime() / 1000);
    expect(presetAfter("7d", now)).toBe(new Date(2026, 10, 11).getTime() / 1000);
  });
});
