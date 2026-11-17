// SPDX-License-Identifier: Apache-2.0

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InvitedSeatsMenuItems, SeatUsageBreakdown } from "../SeatUsageBreakdown";

const cells = (html: string) => [...html.matchAll(/<td>(\d+)<\/td>/g)].map((m) => Number(m[1]));

function render(overrides: Partial<Parameters<typeof SeatUsageBreakdown>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(SeatUsageBreakdown, {
      seats: { purchased: 10, used: 4, reserved: 2, pendingDecrease: null },
      canManage: true,
      onManage: vi.fn(),
      ...overrides,
    }),
  );
}

describe("SeatUsageBreakdown", () => {
  it("shows 좌석, 사용 중, 초대됨 and 남은 좌석 without a caption", () => {
    const html = render();
    for (const h of ["좌석", "사용 중", "초대됨", "남은 좌석"]) expect(html).toContain(`<th>${h}</th>`);
    expect(cells(html)).toEqual([10, 4, 2, 4]);
    expect(html).not.toContain("Seats are what you pay for");
    expect(html).toContain("좌석 추가·변경");
    expect(html).not.toContain("Planned seat change");
  });

  it("never shows negative availability", () => {
    expect(cells(render({ seats: { purchased: 3, used: 3, reserved: 2, pendingDecrease: null } }))).toEqual([3, 3, 2, 0]);
  });

  it("never shows a planned decrease on the card (it lives in Manage seats)", () => {
    const html = render({
      seats: { purchased: 8, used: 3, reserved: 0, pendingDecrease: { to: 5, effectiveAt: "2026-11-01" } },
    });
    expect(html).not.toContain("Planned seat change");
    expect(html).not.toContain("Keep 8 seats");
    expect(cells(html)).toEqual([8, 3, 0, 5]);
  });

  it("is read-only for non-owners", () => {
    const html = render({ canManage: false });
    expect(html).not.toContain("좌석 추가·변경");
  });

  it("keeps the Invited number plain when nothing says where the invitations are", () => {
    for (const html of [render(), render({ invitedByVault: [] })]) {
      expect(cells(html)).toEqual([10, 4, 2, 4]);
      expect(html).not.toContain("seat-invited-trigger");
    }
  });

  it("keeps zero invited as plain text with nothing to open", () => {
    const html = render({
      seats: { purchased: 10, used: 4, reserved: 0, pendingDecrease: null },
      invitedByVault: [{ orgId: "a", name: "Design", count: 0 }],
    });
    expect(cells(html)).toEqual([10, 4, 0, 6]);
    expect(html).not.toContain("seat-invited-trigger");
  });

  it("makes the Invited number the control, with no chips under it", () => {
    const html = render({
      invitedByVault: [
        { orgId: "a", name: "Design", count: 1 },
        { orgId: "b", name: "Sales", count: 1 },
      ],
    });
    expect(html).not.toContain("plan-page-vault-chip");
    expect(html).toContain('class="seat-invited-trigger"');
    expect(html).toContain('aria-label="볼트 2개에 초대 2명"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<button[^>]*seat-invited-trigger[^>]*>2<\/button>/);
    // The other three cells stay plain numbers on the same row.
    expect(cells(html)).toEqual([10, 4, 4]);
  });
});

describe("InvitedSeatsMenuItems", () => {
  const vaults = [
    { orgId: "b", name: "Hello 4", count: 2 },
    { orgId: "a", name: "Design", count: 1 },
  ];
  const html = renderToStaticMarkup(
    createElement(InvitedSeatsMenuItems, { total: 3, vaults, onChoose: vi.fn() }),
  );

  it("heads the list with the total", () => {
    expect(html).toContain("<span>초대됨</span>");
    expect(html).toContain("초대 3명");
  });

  it("lists one row per vault in the order given, each opening that vault", () => {
    const names = [...html.matchAll(/seat-invited-name">([^<]+)</g)].map((m) => m[1]);
    expect(names).toEqual(["Hello 4", "Design"]);
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toContain("Hello 4의 멤버와 초대 열기");
  });

  it("ends with the seat-hold hint", () => {
    expect(html).toContain("대기 중인 초대는 수락하거나 만료될 때까지 좌석을 차지해요.");
  });
});
