import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  isLegacyPlan,
  legacyPlanLine,
  peopleTableCopy,
  membersSeatLine,
  invitePrewarning,
  freePeopleCopy,
  seatBreakdown,
  formatBytes,
  planPriceLine,
  seatChangeSummary,
  seatsUpdatedToast,
  seatUsageLines,
  usageAgainstLimit,
  classifyLimitError,
  FREE_PLAN_EXPLANATION,
  limitFromError,
  planPillLabel,
  PRO_BENEFITS,
  TEAM_BENEFITS,
  FREE_PLAN_LACKS,
  FREE_PLAN_INCLUDES,
  LIMIT_CODES,
  seatLimitFromError,
  seatBounds,
  defaultSeats,
  seatTotalCents,
  seatTotalLine,
  yearlySavingsLabel,
  billingErrorMessage,
  discountLine,
  RESUME_TO_CHANGE_SEATS,
  seatChangeLocked,
  vaultPlanLine,
  planStatusPill,
  formatMoney,
  seatsFullCopy,
  subscriptionStatusLine,
  transferTargets,
  type SubscriptionFacts,
  type SubscriptionLineFormat,
  seatsDialogSubtitle,
  invitedCountAriaLabel,
  invitedTotalLabel,
  invitedVaultAction,
  invitedVaultFallbackToast,
  invitedVaults,
} from "./billing";

describe("plan benefits copy", () => {
  it("explains the Free note allowance and Team benefits", () => {
    expect(PRO_BENEFITS).toContain("독립 파일 동기화");
    expect(PRO_BENEFITS.join(" ")).not.toMatch(/unlimited notes|AI edits/i);
    expect(FREE_PLAN_EXPLANATION).toMatch(/노트 동기화, 포함된 첨부 파일/);
    expect(FREE_PLAN_EXPLANATION).toMatch(/포함된 첨부 파일/);
    expect(FREE_PLAN_EXPLANATION).toMatch(/독립 파일 동기화/);
  });
});

describe("classifyLimitError", () => {
  it("returns null for non-ApiError values", () => {
    expect(classifyLimitError(new Error("boom"))).toBeNull();
    expect(classifyLimitError("nope")).toBeNull();
    expect(classifyLimitError(null)).toBeNull();
  });

  it("returns null for non-402 ApiErrors even with the token present", () => {
    expect(
      classifyLimitError(new ApiError(403, "member_limit_reached", { error: "member_limit_reached" })),
    ).toBeNull();
    expect(classifyLimitError(new ApiError(500, "boom"))).toBeNull();
  });

  it("classifies a 402 with a clean vault token body", () => {
    const e = new ApiError(402, "vault_limit_reached", {
      error: "vault_limit_reached",
      limit: 3,
    });
    expect(classifyLimitError(e)).toBe("vault_limit");
  });

  it("classifies a 402 with a clean member token body", () => {
    const e = new ApiError(402, "member_limit_reached", {
      error: "member_limit_reached",
      limit: 3,
    });
    expect(classifyLimitError(e)).toBe("member_limit");
  });

  it("classifies when the token is only in the message (Better Auth path)", () => {
    // Body shape uncontrolled, but the message carries the literal token.
    const e = new ApiError(402, "Upgrade required: member_limit_reached", {
      code: "PLAN_LIMIT",
    });
    expect(classifyLimitError(e)).toBe("member_limit");
  });

  it("classifies when the token is only in a stringified body", () => {
    const e = new ApiError(402, "HTTP 402", "vault_limit_reached");
    expect(classifyLimitError(e)).toBe("vault_limit");
  });

  it("returns null for a 402 without any contract token", () => {
    expect(classifyLimitError(new ApiError(402, "payment required", { error: "card_declined" }))).toBeNull();
  });
});

describe("limitFromError", () => {
  it("extracts a numeric limit from the body", () => {
    expect(limitFromError(new ApiError(402, "member_limit_reached", { limit: 3 }))).toBe(3);
  });

  it("returns null when there's no numeric limit", () => {
    expect(limitFromError(new ApiError(402, "member_limit_reached", { error: "x" }))).toBeNull();
    expect(limitFromError(new ApiError(402, "x", "string body"))).toBeNull();
    expect(limitFromError(new Error("boom"))).toBeNull();
  });
});

// Deterministic stand-ins for the real formatters, so these assertions don't
// depend on the test machine's locale.
const FMT: SubscriptionLineFormat = {
  date: (iso) => `D(${iso})`,
  price: (amount, currency, interval) => `${currency}${amount / 100}${interval ?? "?"}`,
};

const facts = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  status: "active",
  currentPeriodEnd: "2026-10-03T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  interval: "month",
  amount: 1000,
  currency: "usd",
  ...over,
});

describe("subscriptionStatusLine", () => {
  it("says nothing about a vault with no subscription", () => {
    expect(subscriptionStatusLine(facts({ status: "none" }), FMT)).toBeNull();
  });

  it("writes the renewal date and the price for a live subscription", () => {
    expect(subscriptionStatusLine(facts(), FMT)).toBe(
      "D(2026-10-03T00:00:00.000Z) 갱신 · usd10month",
    );
  });

  it("writes an end date, never a renewal, once it is cancelling", () => {
    const line = subscriptionStatusLine(facts({ cancelAtPeriodEnd: true }), FMT);
    expect(line).toBe("D(2026-10-03T00:00:00.000Z) 종료 예정");
    expect(line).not.toContain("Renews");
  });

  it("falls back to prose when a cancelling subscription has no end date", () => {
    expect(
      subscriptionStatusLine(facts({ cancelAtPeriodEnd: true, currentPeriodEnd: null }), FMT),
    ).toBe("현재 기간이 끝나면 종료돼요");
  });

  it("lets past_due outrank the date and the price", () => {
    expect(subscriptionStatusLine(facts({ status: "past_due" }), FMT)).toBe("결제 지연");
    // Even mid-cancellation: the money is the thing to say.
    expect(
      subscriptionStatusLine(facts({ status: "past_due", cancelAtPeriodEnd: true }), FMT),
    ).toBe("결제 지연");
  });

  it("reports a canceled subscription in the past tense", () => {
    expect(subscriptionStatusLine(facts({ status: "canceled" }), FMT)).toBe(
      "D(2026-10-03T00:00:00.000Z) 종료",
    );
    expect(
      subscriptionStatusLine(facts({ status: "canceled", currentPeriodEnd: null }), FMT),
    ).toBe("해지됨");
  });

  it("omits the price when the provider gave us none", () => {
    expect(subscriptionStatusLine(facts({ amount: null, currency: null }), FMT)).toBe(
      "D(2026-10-03T00:00:00.000Z) 갱신",
    );
  });

  it("prices a subscription with no renewal date on its own", () => {
    expect(subscriptionStatusLine(facts({ currentPeriodEnd: null }), FMT)).toBe("usd10month");
  });

  it("returns null for a live subscription we know nothing else about", () => {
    expect(
      subscriptionStatusLine(
        facts({ currentPeriodEnd: null, amount: null, currency: null }),
        FMT,
      ),
    ).toBeNull();
  });

  it("treats a zero amount as a real price, not a missing one", () => {
    expect(subscriptionStatusLine(facts({ amount: 0, currentPeriodEnd: null }), FMT)).toBe(
      "usd0month",
    );
  });
});

describe("planPillLabel", () => {
  it("labels every free vault Free, whatever its dead subscription says", () => {
    expect(planPillLabel({ plan: "free", status: "none" })).toBe("Free");
    expect(planPillLabel({ plan: "free", status: "canceled" })).toBe("Free");
  });

  it("labels a healthy paid plan just Team", () => {
    expect(planPillLabel({ plan: "pro", status: "active" })).toBe("Team");
    expect(planPillLabel({ plan: "team", status: "active" })).toBe("Team");
  });

  it("surfaces the states worth interrupting for", () => {
    expect(planPillLabel({ plan: "pro", status: "past_due" })).toBe("결제 지연");
    expect(planPillLabel({ plan: "pro", status: "canceled" })).toBe("해지됨");
  });
});

describe("transferTargets", () => {
  const v = (
    orgId: string,
    role: "owner" | "admin" | "member",
    plan: "free" | "pro",
    status: SubscriptionFacts["status"] = plan === "pro" ? "active" : "none",
  ) => ({ orgId, role, plan, status });

  const all = [
    v("src", "owner", "pro"),
    v("mine-free", "owner", "free"),
    v("mine-pro", "owner", "pro"),
    v("admin-free", "admin", "free"),
    v("member-free", "member", "free"),
    v("mine-canceled", "owner", "free", "canceled"),
  ];

  it("offers owned free vaults, including one whose old subscription is canceled", () => {
    expect(transferTargets(all, "src").map((t) => t.orgId)).toEqual([
      "mine-free",
      "mine-canceled",
    ]);
  });

  it("never offers the source itself", () => {
    expect(transferTargets(all, "mine-free").map((t) => t.orgId)).toEqual(["mine-canceled"]);
  });

  it("refuses vaults the caller only administers or belongs to", () => {
    const ids = transferTargets(all, "src").map((t) => t.orgId);
    expect(ids).not.toContain("admin-free");
    expect(ids).not.toContain("member-free");
  });

  it("refuses a vault that is already paying", () => {
    const ids = transferTargets(all, "src").map((t) => t.orgId);
    expect(ids).not.toContain("mine-pro");
    expect(
      transferTargets([v("t", "owner", "free", "past_due")], "src").map((t) => t.orgId),
    ).toEqual([]);
  });

  it("returns an empty list when there is nowhere to move it", () => {
    expect(transferTargets([v("src", "owner", "pro")], "src")).toEqual([]);
    expect(transferTargets([], "src")).toEqual([]);
  });
});

it("recognizes the note sync quota upgrade error", () => {
  expect(classifyLimitError(new ApiError(402, "Upgrade", { code: "note_limit_reached", limit: 20000 }))).toBe("note_limit");
});

describe("Team plan copy", () => {
  it("drops the stray line and keeps the old export as an alias", () => {
    expect(TEAM_BENEFITS.join(" ")).not.toMatch(/TypeSafe/);
    expect(PRO_BENEFITS).toBe(TEAM_BENEFITS);
    expect(FREE_PLAN_LACKS).toContain("독립 파일 동기화");
    expect(TEAM_BENEFITS).toEqual([
      "인원 무제한, 1인당 1좌석",
      "동기화 볼트 무제한",
      "독립 파일 동기화",
      "우선 지원",
    ]);
    expect(FREE_PLAN_INCLUDES).toEqual([
      "2명",
      "동기화 볼트 1개",
      "노트와 첨부 파일 무제한",
      "AI 도구용 MCP",
      "실시간 협업",
    ]);
    expect(FREE_PLAN_EXPLANATION).toMatch(/2명/);
    expect(seatsFullCopy(5)).toBe("좌석 5개를 모두 사용 중이에요.");
    expect(seatsFullCopy(null)).toBe("좌석을 모두 사용 중이에요.");
  });
});

describe("seat helpers", () => {
  it("floors the stepper at max(minSeats, used) with no ceiling", () => {
    expect(seatBounds(1, 3)).toEqual({ min: 3, max: null });
    expect(seatBounds(3, 3)).toEqual({ min: 3, max: null });
    expect(seatBounds(7, 3)).toEqual({ min: 7, max: null });
    expect(defaultSeats(1, 3)).toBe(3);
    expect(defaultSeats(7, 3)).toBe(7);
  });

  it("totals monthly and yearly prices", () => {
    expect(seatTotalCents(5, 1000)).toBe(5000);
    expect(seatTotalCents(5, 11000)).toBe(55000);
    expect(seatTotalLine(5, 1000, "usd", "month")).toBe("좌석 5개 × $10 = $50/월");
    expect(seatTotalLine(3, 11000, "usd", "year")).toBe("좌석 3개 × $110 = $330/년");
    expect(formatMoney(1050, "usd")).toBe("$10.50");
  });

  it("computes the yearly saving from the configured prices", () => {
    const team = (prices: { interval: "month" | "year"; perSeat: number }[]) => ({
      team: { minSeats: 3, currency: "usd", prices },
    });
    expect(
      yearlySavingsLabel(team([{ interval: "month", perSeat: 1000 }, { interval: "year", perSeat: 11000 }])),
    ).toBe("8% 절약");
    expect(
      yearlySavingsLabel(team([{ interval: "month", perSeat: 1000 }, { interval: "year", perSeat: 9600 }])),
    ).toBe("20% 절약");
    expect(yearlySavingsLabel(team([{ interval: "month", perSeat: 1000 }]))).toBeNull();
    expect(yearlySavingsLabel({})).toBeNull();
    expect(yearlySavingsLabel(null)).toBeNull();
  });

  it("writes one discount line with the saving only when charged is below list", () => {
    expect(
      discountLine({ interval: "month", price: { list: 1000, charged: 500, discountName: "legacy" } }),
    ).toBe("기존 가격 $5/월 · $5/월 절약");
    expect(
      discountLine({ interval: "year", price: { list: 33000, charged: 0, discountName: "legacy-acc_1" } }),
    ).toBe("기존 가격 $0/년 · $330/년 절약");
    expect(
      discountLine({ interval: "year", price: { list: 33000, charged: 0, discountName: "LAUNCH100" } }),
    ).toBe("할인 LAUNCH100 · $330/년 절약");
    expect(
      discountLine({ interval: "month", price: { list: 3000, charged: 1000, discountName: null } }),
    ).toBe("할인 적용 · $20/월 절약");
  });

  it("omits the discount line when nothing is saved", () => {
    expect(
      discountLine({ interval: "month", price: { list: 1000, charged: 1000, discountName: null } }),
    ).toBeNull();
    expect(
      discountLine({ interval: "month", price: { list: 1000, charged: 1200, discountName: "legacy" } }),
    ).toBeNull();
    expect(discountLine({ interval: null, price: null })).toBeNull();
  });

  it("says when a discount ends: once, repeating, forever", () => {
    const price = { list: 209000, charged: 0, discountName: "Team Ben" };
    expect(
      discountLine({ interval: "year", price: { ...price, discountDuration: "once", renewalAmount: 209000 } }),
    ).toBe("첫 결제에 할인 Team Ben 적용 · 이후 $2,090/년");
    expect(
      discountLine({
        interval: "month",
        price: { list: 3000, charged: 1500, discountName: "HALF", discountDuration: "repeating", discountDurationMonths: 3, renewalAmount: 1500 },
      }),
    ).toBe("할인 HALF 3개월 · 이후 $15/월");
    expect(
      discountLine({ interval: "year", price: { ...price, discountDuration: "forever", renewalAmount: 0 } }),
    ).toBe("할인 Team Ben · $2,090/년 절약");
    // An older server sends no duration: today's wording.
    expect(discountLine({ interval: "year", price })).toBe("할인 Team Ben · $2,090/년 절약");
  });
});

describe("Team limit codes", () => {
  const err = (body: unknown, status = 402) => new ApiError(status, "rejected", body);

  it("classifies every 402 code", () => {
    expect(classifyLimitError(err({ error: "seat_limit_reached", seats: 5, used: 5, pending: 1 }))).toBe("seat_limit");
    expect(classifyLimitError(err({ error: "account_read_only" }))).toBe("read_only");
    expect(classifyLimitError(err({ error: "attachment_sync_requires_pro", requiredPlan: "team" }))).toBe("attachment");
    expect(classifyLimitError(err({ error: "storage_limit_reached" }))).toBe("storage_limit");
    expect(classifyLimitError(err({ error: "member_limit_reached", limit: 2, scope: "account" }))).toBe("member_limit");
    expect(classifyLimitError(err({ error: "seat_limit_reached" }, 403))).toBeNull();
    for (const [code, kind] of LIMIT_CODES) expect(classifyLimitError(err({ error: code }))).toBe(kind);
  });

  it("reads seat counts off a seat_limit_reached error", () => {
    expect(seatLimitFromError(err({ error: "seat_limit_reached", seats: 5, used: 5, pending: 1 }))).toEqual({
      seats: 5,
      used: 5,
      pending: 1,
    });
    expect(seatLimitFromError(err({ error: "seat_limit_reached" }))).toEqual({
      seats: null,
      used: null,
      pending: null,
    });
    expect(seatLimitFromError(err({ error: "member_limit_reached" }))).toBeNull();
  });

  it("labels the pill variants", () => {
    expect(planPillLabel({ plan: "team", status: "active", complimentary: true })).toBe("Team (무료 제공)");
    expect(planPillLabel({ plan: "team", status: "canceled", lapsed: true })).toBe("읽기 전용");
    expect(planPillLabel({ plan: "team", status: "active", readOnly: true })).toBe("읽기 전용");
    expect(planPillLabel({ plan: "team", status: "past_due" })).toBe("결제 지연");
  });
});

describe("Plan & Billing helpers", () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  const base = {
    current: 5,
    floor: 4,
    used: 4,
    minSeats: 3,
    currency: "usd",
    interval: "month" as const,
    formatDate: fmt,
  };
  const preview = { proratedNow: 1250, newAmount: 6000, currentPeriodEnd: "2026-11-01T00:00:00Z" };

  it("seatChangeSummary: the already-scheduled count shows nothing and cannot confirm", () => {
    const at = { ...base, current: 19, scheduled: 3, floor: 3 };
    const p = { ...preview, currentPeriodEnd: "2027-10-08T00:00:00Z" };
    expect(seatChangeSummary({ ...at, seats: 3, preview: p })).toEqual({ text: null, canConfirm: false });
    expect(seatChangeSummary({ ...at, seats: 4, preview: p })).toEqual({
      text: "2027-10-08에 4좌석으로 줄어들어요.",
      canConfirm: true,
    });
    expect(seatChangeSummary({ ...at, seats: 19, preview: p })).toEqual({ text: null, canConfirm: false });
  });

  it("seatsUpdatedToast: a decrease names its date, an increase applies now", () => {
    const end = "2027-10-08T00:00:00Z";
    expect(seatsUpdatedToast(3, 19, end, fmt)).toBe("2027-10-08에 좌석이 3개로 줄어들어요.");
    expect(seatsUpdatedToast(3, 19, null, fmt)).toBe("이번 결제 기간이 끝나면 좌석이 3개로 줄어들어요.");
    expect(seatsUpdatedToast(21, 19, end, fmt)).toBe("좌석을 21개로 변경했어요.");
    expect(seatsUpdatedToast(5, null, end, fmt)).toBe("좌석을 5개로 변경했어요.");
  });

  it("seatChangeSummary: a zero charge today still reads as money, never NaN", () => {
    expect(seatChangeSummary({ ...base, seats: 6, preview: { ...preview, proratedNow: 0, newAmount: 0 } })).toEqual({
      text: "오늘 약 $0이 일할 계산으로 청구되고, 이후 월 $0이 청구돼요.",
      canConfirm: true,
    });
  });

  it("seatChangeSummary: next amount missing falls back to a plain sentence", () => {
    const r = seatChangeSummary({ ...base, seats: 6, preview: { ...preview, newAmount: null } });
    expect(r).toEqual({ text: "정확한 금액은 다음 청구서에 표시돼요.", canConfirm: true });
  });

  it("seatChangeSummary: both amounts missing or absent never render NaN", () => {
    const nulls = { proratedNow: null, newAmount: null, currentPeriodEnd: null };
    expect(seatChangeSummary({ ...base, seats: 6, preview: nulls }).text).toBe(
      "정확한 금액은 다음 청구서에 표시돼요.",
    );
    // An older server that answers other field names.
    const odd = {} as unknown as typeof nulls;
    expect(seatChangeSummary({ ...base, seats: 6, preview: odd }).text).not.toMatch(/NaN/);
    expect(seatChangeSummary({ ...base, seats: 4, preview: nulls }).text).toBe(
      "이번 결제 기간이 끝나면 4좌석으로 줄어들어요.",
    );
  });

  it("seatChangeSummary: charge-now unknown still shows the next amount", () => {
    const r = seatChangeSummary({ ...base, seats: 6, preview: { ...preview, proratedNow: null } });
    expect(r.text).toBe("이후 월 $60이 청구돼요. 정확한 금액은 다음 청구서에 표시돼요.");
  });

  it("seatChangeSummary: increase says 'about' and the next amount", () => {
    expect(seatChangeSummary({ ...base, seats: 6, preview })).toEqual({
      text: "오늘 약 $12.50이 일할 계산으로 청구되고, 이후 월 $60이 청구돼요.",
      canConfirm: true,
    });
  });

  it("seatChangeSummary: decrease names the effective date", () => {
    expect(seatChangeSummary({ ...base, seats: 4, preview })).toEqual({
      text: "2026-11-01에 4좌석으로 줄어들어요.",
      canConfirm: true,
    });
  });

  it("seatChangeSummary: below the floor is refused with the reason", () => {
    const r = seatChangeSummary({ ...base, seats: 3, preview });
    expect(r.canConfirm).toBe(false);
    expect(r.text).toBe(
      "계정에 이미 있는 인원(4명)이나 최소 3좌석보다 적게 줄일 수 없어요.",
    );
  });

  it("seatChangeSummary: unchanged or still loading cannot confirm", () => {
    expect(seatChangeSummary({ ...base, seats: 5, preview })).toEqual({ text: null, canConfirm: false });
    expect(seatChangeSummary({ ...base, seats: 6, preview: null })).toEqual({ text: null, canConfirm: false });
  });

  it("formatBytes uses human units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });

  it("usageAgainstLimit shows the ceiling only when one applies", () => {
    expect(usageAgainstLimit(2, 2, "명", "명")).toBe("2명 중 2명");
    expect(usageAgainstLimit(1, 1, "개", "개")).toBe("1개 중 1개");
    expect(usageAgainstLimit(7, null, "명", "명")).toBe("7명");
  });

  it("planPriceLine prices Team per seat by interval", () => {
    const team = { currency: "usd", prices: [{ interval: "month" as const, perSeat: 1000 }, { interval: "year" as const, perSeat: 11000 }] };
    expect(planPriceLine("free", null, team)).toBe("Free");
    expect(planPriceLine("team", "month", team)).toBe("좌석당 월 $10");
    expect(planPriceLine("team", "year", team)).toBe("좌석당 연 $110");
  });

  it("seatUsageLines adds reserved and pending-decrease lines", () => {
    expect(
      seatUsageLines(
        { purchased: 5, used: 4, reserved: 1, pendingDecrease: { to: 4, effectiveAt: "2026-11-01T00:00:00Z" } },
        fmt,
      ),
    ).toEqual(["좌석 5개 중 4개 사용", "초대 1명", "2026-11-01에 4좌석으로 줄어들어요"]);
    expect(seatUsageLines({ purchased: null, used: 2, reserved: 0, pendingDecrease: null }, fmt)).toEqual([
      "2명",
    ]);
  });
});

describe("seatBreakdown", () => {
  it("counts claimed and reserved against purchased", () => {
    expect(seatBreakdown({ purchased: 10, used: 4, reserved: 2 })).toEqual({
      purchased: 10,
      claimed: 4,
      reserved: 2,
      available: 4,
    });
  });
  it("never reports negative availability", () => {
    expect(seatBreakdown({ purchased: 3, used: 3, reserved: 2 }).available).toBe(0);
    expect(seatBreakdown({ purchased: 3, used: 5, reserved: 0 }).available).toBe(0);
  });
  it("ignores a pending decrease until it takes effect", () => {
    const seats = { purchased: 8, used: 3, reserved: 1, pendingDecrease: { to: 4, effectiveAt: "2026-11-01" } };
    expect(seatBreakdown(seats)).toEqual({ purchased: 8, claimed: 3, reserved: 1, available: 4 });
  });
  it("treats no purchased seats (Free) as 0", () => {
    expect(seatBreakdown({ purchased: null, used: 1, reserved: 0 })).toEqual({
      purchased: 0,
      claimed: 1,
      reserved: 0,
      available: 0,
    });
  });
});

describe("membersSeatLine", () => {
  const team = { plan: "team" as const, seats: { purchased: 5, used: 3, reserved: 1 } };
  it("names the owner's account on Team", () => {
    expect(membersSeatLine(team, "Sara")).toBe("Sara님의 계정의 좌석 5개 중 3개 사용 · 초대 1명");
    expect(membersSeatLine(team, null)).toBe("소유자의 계정의 좌석 5개 중 3개 사용 · 초대 1명");
    expect(membersSeatLine(team, "Sara", true)).toBe("내 계정의 좌석 5개 중 3개 사용 · 초대 1명");
  });
  it("uses the Free wording without purchased seats", () => {
    expect(membersSeatLine({ plan: "free", seats: { purchased: null, used: 1, reserved: 0 } }, "Sara")).toBe(
      "이 계정의 Free에는 2명이 포함돼요 (2명 중 1명 사용)",
    );
  });
});

describe("membersSeatLine on Team without seats", () => {
  const unlimited = { plan: "team" as const, seats: { purchased: null, used: 7, reserved: 0 } };
  it("reads unlimited people, never the Free copy", () => {
    expect(membersSeatLine(unlimited, "Sara", true)).toBe("Team · 내 계정에서 인원 무제한 (7명)");
    expect(membersSeatLine(unlimited, "Sara")).toBe("Team · Sara님의 계정에서 인원 무제한 (7명)");
    expect(membersSeatLine(unlimited, null)).toBe("Team · 소유자의 계정에서 인원 무제한 (7명)");
    expect(membersSeatLine({ ...unlimited, seats: { purchased: null, used: 1, reserved: 0 } }, null, true)).toBe(
      "Team · 내 계정에서 인원 무제한 (1명)",
    );
  });
});

describe("legacy plan", () => {
  const legacy = {
    plan: "team" as const,
    status: "active",
    interval: "month" as const,
    currentPeriodEnd: "2026-11-03T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    seats: { purchased: null },
    price: { charged: 1000 },
    complimentaryUntil: null,
  };
  const fmt = (iso: string) => iso.slice(0, 10);
  it("trusts the server flag either way", () => {
    expect(isLegacyPlan({ ...legacy, legacyPlan: true, seats: { purchased: 5 } })).toBe(true);
    expect(isLegacyPlan({ ...legacy, legacyPlan: false })).toBe(false);
  });
  it("infers it on an older server: live Team with no seats", () => {
    expect(isLegacyPlan(legacy)).toBe(true);
    expect(isLegacyPlan({ ...legacy, seats: { purchased: 3 } })).toBe(false);
    expect(isLegacyPlan({ ...legacy, plan: "free" })).toBe(false);
    expect(isLegacyPlan({ ...legacy, status: "none" })).toBe(false);
  });
  it("excludes a complimentary Team account", () => {
    expect(isLegacyPlan({ ...legacy, complimentaryUntil: "2027-01-01T00:00:00.000Z" })).toBe(false);
  });
  it("shows the real charged price, monthly and yearly, renewing or canceling", () => {
    expect(legacyPlanLine(legacy, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $10/월 · 2026-11-03 갱신",
    );
    expect(legacyPlanLine({ ...legacy, interval: "year", price: { charged: 9900 } }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $99/년 · 2026-11-03 갱신",
    );
    expect(legacyPlanLine({ ...legacy, cancelAtPeriodEnd: true }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $10/월 · 2026-11-03 해지 예정",
    );
    expect(legacyPlanLine({ ...legacy, price: null, currentPeriodEnd: null }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한",
    );
  });
  it("sums several legacy subscriptions on one interval", () => {
    const charges = [
      { amount: 1000, interval: "month" as const },
      { amount: 1000, interval: "month" as const },
    ];
    expect(legacyPlanLine({ ...legacy, legacyCharges: charges }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $20/월 · 2026-11-03 갱신",
    );
  });
  it("sums per interval when the legacy subscriptions differ", () => {
    const charges = [
      { amount: 0, interval: "year" as const },
      { amount: 1000, interval: "month" as const },
    ];
    expect(legacyPlanLine({ ...legacy, legacyCharges: charges }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $10/월 + $0/년 · 2026-11-03 갱신",
    );
  });
  it("one legacy charge reads like the single price; no field falls back to price.charged", () => {
    expect(
      legacyPlanLine({ ...legacy, legacyCharges: [{ amount: 1000, interval: "month" }] }, "usd", fmt),
    ).toBe("기존 요금제 · 기존 가격으로 인원 무제한 · $10/월 · 2026-11-03 갱신");
    expect(legacyPlanLine({ ...legacy, legacyCharges: [] }, "usd", fmt)).toBe(
      "기존 요금제 · 기존 가격으로 인원 무제한 · $10/월 · 2026-11-03 갱신",
    );
  });
  it("people table: no Seat column for legacy or complimentary Team, one seat each when seats are bought", () => {
    expect(peopleTableCopy({ plan: "team", seats: { purchased: null }, legacyPlan: true })).toEqual({
      note: "내 계정의 모든 볼트에 있는 모든 사람이에요.",
      seatColumn: false,
    });
    expect(peopleTableCopy({ plan: "team", seats: { purchased: null } })).toEqual({
      note: "내 계정의 모든 볼트에 있는 모든 사람이에요.",
      seatColumn: false,
    });
    expect(peopleTableCopy({ plan: "team", seats: { purchased: 5 } })).toEqual({
      note: "어느 볼트에 있든 한 사람이 좌석 하나를 사용해요.",
      seatColumn: true,
    });
    expect(peopleTableCopy({ plan: "free", seats: { purchased: null } })).toEqual({ note: null, seatColumn: false });
  });
});

describe("team-model vault limit copy", () => {
  it("names the account's synced-vault allowance and the Team upgrade", async () => {
    const { teamVaultLimitCopy, vaultLimitReason, PEOPLE_LIMIT_REASON } = await import("./billing");
    expect(teamVaultLimitCopy(1)).toBe(
      "Free 계정에는 동기화 볼트 1개가 포함돼요. 동기화 볼트를 무제한으로 쓰려면 Team으로 업그레이드하세요.",
    );
    // A grandfathered account's server limit is above the default.
    expect(teamVaultLimitCopy(3)).toBe(
      "Free 계정에는 동기화 볼트 3개가 포함돼요. 동기화 볼트를 무제한으로 쓰려면 Team으로 업그레이드하세요.",
    );
    expect(vaultLimitReason(1)).toBe("Free에는 동기화 볼트 1개가 포함돼요. Team은 제한이 없어요.");
    expect(PEOPLE_LIMIT_REASON).toBe("Free에는 2명이 포함돼요. Team은 제한이 없어요.");
  });
});

describe("classifyBillingConfigResult", () => {
  it("reads a 404 from the billing routes as disabled", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(classifyBillingConfigResult(new ApiError(404, "Not found"))).toBe("disabled");
  });
  it("reads a 200 with enabled:false as disabled", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(classifyBillingConfigResult({ enabled: false })).toBe("disabled");
  });
  it("never reads a network failure as disabled", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(classifyBillingConfigResult(new TypeError("Failed to fetch"))).toBe("error");
  });
  it("never reads a 5xx or an auth failure as disabled", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(classifyBillingConfigResult(new ApiError(500, "HTTP 500"))).toBe("error");
    expect(classifyBillingConfigResult(new ApiError(502, "HTTP 502"))).toBe("error");
    expect(classifyBillingConfigResult(new ApiError(401, "HTTP 401"))).toBe("error");
  });
  it("treats an unparseable answer as an error", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(classifyBillingConfigResult(null)).toBe("error");
    expect(classifyBillingConfigResult("<html>")).toBe("error");
    expect(classifyBillingConfigResult({})).toBe("error");
  });
  it("routes a good config by its model", async () => {
    const { classifyBillingConfigResult } = await import("./billing");
    expect(
      classifyBillingConfigResult({
        enabled: true,
        model: "team",
        team: { currency: "usd" },
      }),
    ).toBe("team");
    expect(classifyBillingConfigResult({ enabled: true, model: "vault" })).toBe("vault");
    expect(classifyBillingConfigResult({ enabled: true })).toBe("vault");
  });
});

describe("legacy (per-vault) plan copy", () => {
  it("keeps the old Pro promise apart from Team's", async () => {
    const { LEGACY_PRO_BENEFITS, TEAM_BENEFITS } = await import("./billing");
    expect(LEGACY_PRO_BENEFITS).toEqual([
      "팀 멤버 무제한",
      "독립 파일 동기화",
      "무료 볼트 개수에 포함되지 않음",
    ]);
    expect(LEGACY_PRO_BENEFITS).not.toEqual(TEAM_BENEFITS);
  });
  it("defaults to 3 members per vault and 2 free vaults", async () => {
    const { LEGACY_FREE_PLAN_EXPLANATION } = await import("./billing");
    expect(LEGACY_FREE_PLAN_EXPLANATION).toBe(
      "Free에는 볼트당 멤버 3명, 무료 볼트 2개, 노트 동기화, 포함된 첨부 파일, MCP가 들어 있어요. Pro는 멤버 무제한과 독립 파일 동기화를 더해요.",
    );
  });
  it("reads the numbers from the server's freeLimits", async () => {
    const { legacyFreePlanExplanation } = await import("./billing");
    const line = legacyFreePlanExplanation({ vaultsPerUser: 1, membersPerVault: 5 });
    expect(line).toMatch(/^Free에는 볼트당 멤버 5명, 무료 볼트 1개, /);
    expect(line).not.toMatch(/Team/);
  });
});

describe("planStatusPill", () => {
  const fmt = (iso: string) => `D(${iso})`;
  const team = {
    plan: "team" as const,
    status: "active" as const,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2027-10-08",
    lapsed: false,
  };

  it("says Active for a healthy Team plan and nothing for Free", () => {
    expect(planStatusPill(team, fmt)).toEqual({ label: "사용 중", tone: "active" });
    expect(planStatusPill({ ...team, plan: "free", status: "none" }, fmt)).toBeNull();
  });

  it("says when a cancelling plan ends, in amber", () => {
    expect(planStatusPill({ ...team, cancelAtPeriodEnd: true }, fmt)).toEqual({
      label: "D(2027-10-08) 해지 예정",
      tone: "past_due",
    });
  });

  it("says Past due in amber", () => {
    expect(planStatusPill({ ...team, status: "past_due" }, fmt)).toEqual({ label: "결제 지연", tone: "past_due" });
  });

  it("says Read-only for a lapsed account, Free included", () => {
    expect(planStatusPill({ ...team, lapsed: true }, fmt)).toEqual({ label: "읽기 전용", tone: "canceled" });
    expect(planStatusPill({ ...team, plan: "free", status: "none", lapsed: true }, fmt)?.label).toBe("읽기 전용");
  });
});

describe("vaultPlanLine", () => {
  const fmt = (iso: string) => `D(${iso})`;
  const account = {
    id: "acc_me",
    plan: "team" as const,
    status: "active" as const,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2027-10-08",
    lapsed: false,
  };

  it("names the plan like Plan & Billing on the owner's own account, Active pill included", () => {
    expect(
      vaultPlanLine({ account, vaultAccountId: "acc_me", fallbackPlan: "free", isOwner: true, fmtDate: fmt }),
    ).toEqual({ plan: "Team", status: { label: "사용 중", tone: "active" }, billedOn: null });
    expect(
      vaultPlanLine({ account: { ...account, plan: "free", status: "none" }, vaultAccountId: null, fallbackPlan: "team", isOwner: true, fmtDate: fmt }),
    ).toEqual({ plan: "Free", status: null, billedOn: null });
  });

  it("shows the status pill when there is something to say", () => {
    expect(
      vaultPlanLine({ account: { ...account, cancelAtPeriodEnd: true }, vaultAccountId: null, fallbackPlan: "free", isOwner: true, fmtDate: fmt }).status,
    ).toEqual({ label: "D(2027-10-08) 해지 예정", tone: "past_due" });
    expect(
      vaultPlanLine({ account: { ...account, lapsed: true }, vaultAccountId: null, fallbackPlan: "team", isOwner: true, fmtDate: fmt }).status,
    ).toEqual({ label: "읽기 전용", tone: "canceled" });
  });

  it("names the owner's account for a member", () => {
    expect(
      vaultPlanLine({ account: null, vaultAccountId: "acc_o", fallbackPlan: "team", isOwner: false, ownerName: "Sara", fmtDate: fmt }),
    ).toEqual({ plan: "Team", status: { label: "사용 중", tone: "active" }, billedOn: "Sara님의 계정으로 결제돼요" });
    expect(
      vaultPlanLine({ account: null, vaultAccountId: null, fallbackPlan: "free", isOwner: false, fmtDate: fmt }).billedOn,
    ).toBe("소유자의 계정으로 결제돼요");
  });

  it("uses the vault's resolved plan when an owner's vault is billed on another account", () => {
    expect(
      vaultPlanLine({ account, vaultAccountId: "acc_other", fallbackPlan: "free", isOwner: true, fmtDate: fmt }),
    ).toEqual({ plan: "Free", status: null, billedOn: "다른 계정으로 결제돼요" });
  });
});

describe("billingErrorMessage", () => {
  it("maps a canceling subscription to the resume sentence or the server's message", () => {
    expect(billingErrorMessage(new ApiError(409, "subscription_canceling", { error: "subscription_canceling" }))).toBe(
      RESUME_TO_CHANGE_SEATS,
    );
    expect(
      billingErrorMessage(
        new ApiError(409, "x", { code: "subscription_canceling", message: "Your plan ends on 8 Oct. Resume it first." }),
      ),
    ).toBe("Your plan ends on 8 Oct. Resume it first.");
  });

  it("never shows a raw provider string", () => {
    const raw = "Polar subscriptions.update(seats): Forbidden (HTTP 403)";
    const out = billingErrorMessage(new ApiError(502, raw, { error: "provider_error", message: raw }));
    expect(out).not.toMatch(/Polar|HTTP/);
    expect(billingErrorMessage(new ApiError(403, raw, { error: raw }))).not.toMatch(/Polar|HTTP/);
    expect(billingErrorMessage(new ApiError(500, "HTTP 500"))).not.toMatch(/HTTP/);
  });

  it("keeps a plain server message and plain non-API errors", () => {
    expect(billingErrorMessage(new ApiError(400, "x", { message: "Seats must be at least 3." }))).toBe(
      "Seats must be at least 3.",
    );
    expect(billingErrorMessage(new Error("Network is offline"))).toBe("Network is offline");
  });
});

describe("seatChangeLocked", () => {
  it("locks seat changes only while the plan is set to cancel", () => {
    expect(seatChangeLocked({ cancelAtPeriodEnd: true })).toBe(true);
    expect(seatChangeLocked({ cancelAtPeriodEnd: false })).toBe(false);
  });

  it("maps the server's subscription_canceling refusal to its message", () => {
    expect(
      billingErrorMessage(
        new ApiError(409, "x", { error: "subscription_canceling", message: "Resume your plan before changing seats." }),
      ),
    ).toBe("Resume your plan before changing seats.");
    expect(
      billingErrorMessage(
        new ApiError(403, "Polar subscriptions.update(seats): subscription already canceled (HTTP 403)"),
      ),
    ).not.toMatch(/Polar|HTTP/);
  });
});

describe("invitePrewarning", () => {
  const team = (purchased: number, used: number, reserved: number) => ({ plan: "team" as const, seats: { purchased, used, reserved } });
  it("is silent while a seat is free", () => {
    expect(invitePrewarning(team(5, 3, 1), "Sara", true)).toBeNull();
  });
  it("warns the owner with Add seats when every seat is taken", () => {
    const w = invitePrewarning(team(19, 17, 2), "Sara", true);
    expect(w?.action).toBe("add-seats");
    expect(w?.text).toContain("좌석 19개를 모두 사용 중이에요.");
    expect(w?.text).toContain("2좌석이 예약");
  });
  it("tells an admin whom to ask, with no action", () => {
    expect(invitePrewarning(team(3, 3, 0), "Sara", false)).toEqual({ text: "좌석 3개를 모두 사용 중이에요. Sara에게 좌석 추가 요청하세요.", action: null });
  });
  it("Free at 2 people: owner gets Upgrade, admin is told to ask", () => {
    const free = { plan: "free" as const, seats: { purchased: null, used: 1, reserved: 1 } };
    expect(invitePrewarning(free, "Sara", true)?.action).toBe("upgrade");
    expect(invitePrewarning(free, null, false)?.text).toBe("Free에는 2명이 포함돼요. 볼트 소유자에게 Team 업그레이드 요청하세요.");
    expect(invitePrewarning({ ...free, seats: { purchased: null, used: 1, reserved: 0 } }, "Sara", true)).toBeNull();
  });
});

describe("grandfathered Free limit in the copy", () => {
  const free3 = { plan: "free" as const, seats: { purchased: null, used: 3, reserved: 0 }, limits: { people: 3 } };
  it("reads the account's own limit", () => {
    expect(membersSeatLine(free3, "Sara")).toBe("이 계정의 Free에는 3명이 포함돼요 (3명 중 3명 사용)");
    expect(invitePrewarning(free3, "Sara", true)).toEqual({ text: "Free에는 3명이 포함돼요. 더 추가하려면 Team으로 업그레이드하세요.", action: "upgrade" });
    expect(invitePrewarning({ ...free3, seats: { purchased: null, used: 2, reserved: 0 } }, "Sara", true)).toBeNull();
    expect(freePeopleCopy(3)).toBe("Free에는 3명이 포함돼요. 더 추가하려면 Team으로 업그레이드하세요.");
  });
  it("keeps 2 when the account carries no limit", () => {
    expect(membersSeatLine({ plan: "free", seats: { purchased: null, used: 1, reserved: 0 } }, null)).toBe(
      "이 계정의 Free에는 2명이 포함돼요 (2명 중 1명 사용)",
    );
  });
});

describe("seatsDialogSubtitle", () => {
  it("names seats and people with singular forms", () => {
    expect(seatsDialogSubtitle(19, 1)).toBe("좌석 19개 · 내 계정에 1명");
    expect(seatsDialogSubtitle(1, 3)).toBe("좌석 1개 · 내 계정에 3명");
  });
  it("reads as people only before a first purchase", () => {
    expect(seatsDialogSubtitle(null, 2)).toBe("내 계정에 2명");
  });
});

describe("invited-seat vaults", () => {
  it("drops empty or missing lists and zero counts", () => {
    expect(invitedVaults(undefined)).toEqual([]);
    expect(invitedVaults(null)).toEqual([]);
    expect(invitedVaults([{ orgId: "a", name: "A", count: 0 }, { orgId: "b", name: "B", count: 3 }])).toEqual([
      { orgId: "b", name: "B", count: 3 },
    ]);
  });

  it("orders by count, most first, then by name ignoring case", () => {
    const list = [
      { orgId: "1", name: "sales", count: 1 },
      { orgId: "2", name: "Design", count: 1 },
      { orgId: "3", name: "Ops", count: 4 },
      { orgId: "4", name: "Hello 4", count: 2 },
    ];
    expect(invitedVaults(list).map((v) => v.name)).toEqual(["Ops", "Hello 4", "Design", "sales"]);
    // The server's array is left alone.
    expect(list[0].name).toBe("sales");
  });

  it("labels the total and names the vaults for assistive tech", () => {
    expect(invitedTotalLabel(2)).toBe("초대 2명");
    const one = [{ orgId: "a", name: "Hello 4", count: 2 }];
    expect(invitedCountAriaLabel(2, one)).toBe("Hello 4에 초대 2명");
    const two = [...one, { orgId: "b", name: "Sales", count: 1 }];
    expect(invitedCountAriaLabel(3, two)).toBe("볼트 2개에 초대 3명");
  });

  it("opens Members and access for the open vault, switches to a bound one, else the Vaults tab", () => {
    const base = { activeOrgId: "a", openPath: "/v/a" };
    expect(invitedVaultAction({ ...base, orgId: "a", boundPath: "/v/a" })).toBe("open-members");
    expect(invitedVaultAction({ ...base, orgId: "a", boundPath: null })).toBe("open-members");
    expect(invitedVaultAction({ ...base, orgId: "b", boundPath: "/v/b" })).toBe("switch-then-members");
    expect(invitedVaultAction({ ...base, orgId: "b", boundPath: null })).toBe("vaults-tab");
    // Active org but another folder on screen: switch to its own folder first.
    expect(invitedVaultAction({ ...base, orgId: "a", boundPath: "/v/other" })).toBe("switch-then-members");
    // Nothing open at all and no folder here.
    expect(invitedVaultAction({ orgId: "a", activeOrgId: "a", openPath: null, boundPath: null })).toBe("vaults-tab");
  });

  it("tells the user to open the vault when it is not on this device", () => {
    expect(invitedVaultFallbackToast("Design")).toBe("Design을(를) 열어 초대를 관리하세요.");
  });
});
