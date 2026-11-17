import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  acceptInviteFailureMessage,
  clearPendingInvite,
  INVITE_GONE_MESSAGE,
  peekPendingInvite,
  queueInvite,
  takePendingInvite,
} from "../inviteFlow";

/**
 * The invite flow's pure parts (#99).
 *
 * The queue is a handoff between two moments of one flow (link arrives →
 * session exists), and the message mapping is the difference between an
 * invitation failing usefully and failing with Better Auth's raw wording, which
 * names neither address involved.
 */
describe("pending invite queue", () => {
  beforeEach(() => clearPendingInvite());

  it("hands back what was queued, exactly once", () => {
    queueInvite({ invitationId: "inv_1", server: null });
    expect(peekPendingInvite()).toEqual({ invitationId: "inv_1", server: null });
    // Peeking must not consume — the landing skip reads it and acceptance eats it.
    expect(takePendingInvite()).toEqual({ invitationId: "inv_1", server: null });
    expect(takePendingInvite()).toBeNull();
  });

  it("keeps only the latest — two clicks means the second one matters", () => {
    queueInvite({ invitationId: "inv_1", server: null });
    queueInvite({ invitationId: "inv_2", server: "https://notes.example.com" });
    expect(takePendingInvite()).toEqual({
      invitationId: "inv_2",
      server: "https://notes.example.com",
    });
  });

  it("clears without consuming into a caller", () => {
    queueInvite({ invitationId: "inv_1", server: null });
    clearPendingInvite();
    expect(peekPendingInvite()).toBeNull();
  });
});

describe("acceptInviteFailureMessage", () => {
  it("names both addresses on a recipient mismatch", () => {
    const msg = acceptInviteFailureMessage(
      new Error("You are not the recipient of the invitation"),
      { inviteEmail: "ada@team.com", sessionEmail: "me@personal.com" },
    );
    expect(msg).toBe(
      "이 초대는 ada@team.com(으)로 보내졌지만 me@personal.com(으)로 로그인되어 있어요. " +
        "로그아웃한 뒤 ada@team.com(으)로 로그인하거나, 관리자에게 me@personal.com(으)로 다시 초대해 달라고 요청해 주세요.",
    );
  });

  it("stays vague rather than naming a wrong address when one is unknown", () => {
    const msg = acceptInviteFailureMessage(
      new Error("You are not the recipient of the invitation"),
      { inviteEmail: null, sessionEmail: "me@personal.com" },
    );
    expect(msg).toContain("다른 주소로 보내졌어요");
    expect(msg).not.toContain("null");
  });

  it("merges expired / used / revoked into one honest sentence", () => {
    expect(
      acceptInviteFailureMessage(new Error("Invitation not found"), {
        inviteEmail: "ada@team.com",
        sessionEmail: "ada@team.com",
      }),
    ).toBe(INVITE_GONE_MESSAGE);
  });

  it("keeps an unrecognised server message instead of inventing friendlier copy", () => {
    expect(
      acceptInviteFailureMessage(new Error("Organization member limit reached"), {
        inviteEmail: "ada@team.com",
        sessionEmail: "ada@team.com",
      }),
    ).toBe("Organization member limit reached");
  });

  it("survives a thrown non-Error", () => {
    expect(
      acceptInviteFailureMessage("Invitation not found", {
        inviteEmail: null,
        sessionEmail: null,
      }),
    ).toBe(INVITE_GONE_MESSAGE);
    expect(
      acceptInviteFailureMessage(undefined, { inviteEmail: null, sessionEmail: null }),
    ).toBe(INVITE_GONE_MESSAGE);
  });
});

describe("acceptInviteFailureMessage: people limits at acceptance", () => {
  const ctx = { inviteEmail: "a@x.com", sessionEmail: "a@x.com" };
  it("a full Team vault tells the invitee whom to ask", () => {
    const e = new ApiError(402, "All 5 seats are in use.", { error: "seat_limit_reached", seats: 5, used: 5, pending: 0 });
    expect(acceptInviteFailureMessage(e, ctx)).toBe(
      "좌석 5개를 모두 사용 중이에요. 초대한 사람에게 좌석을 추가해 달라고 요청한 뒤 다시 수락해 주세요.",
    );
  });
  it("a full Free vault uses the account's own limit", () => {
    const e = new ApiError(402, "member_limit_reached", { error: "member_limit_reached", limit: 3, scope: "account" });
    expect(acceptInviteFailureMessage(e, ctx)).toBe(
      "Free에는 3명이 포함돼요. 이 볼트는 가득 찼어요. 초대한 사람에게 Team으로 업그레이드해 달라고 요청한 뒤 다시 수락해 주세요.",
    );
  });
  it("a lapsed account says it cannot take new people", () => {
    const e = new ApiError(402, "x", { error: "account_read_only" });
    expect(acceptInviteFailureMessage(e, ctx)).toMatch(/새 멤버를 받을 수 없어요/);
  });
});
