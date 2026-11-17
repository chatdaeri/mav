/**
 * The invite-accept flow's pure parts: the pending-invite queue (an invitation
 * that arrived before there was a session, or before the app was pointed at the
 * right server) and the failure-message mapping.
 *
 * Pure and store-free so it unit-tests in node, the `noteLinkFlow` pattern.
 */

import type { InviteDeepLink } from "./inviteLink";
import { classifyLimitError, freePeopleIncluded, limitFromError, seatLimitFromError, seatsFullCopy } from "./billing";

// ---- Pending invite queue --------------------------------------------------
// Module state, not store state — a handoff between two moments of one flow
// (link arrives → session exists), never something the UI renders. The UI reads
// `invitePrompt` in the store instead, which holds the PREVIEW.
//
// Only the latest invite is kept: clicking two invitation links while signed
// out means the second one is the one the person is still waiting on.

let pendingInvite: InviteDeepLink | null = null;

export function queueInvite(invite: InviteDeepLink): void {
  pendingInvite = invite;
}

export function takePendingInvite(): InviteDeepLink | null {
  const invite = pendingInvite;
  pendingInvite = null;
  return invite;
}

/** Read without consuming — for guards that must not eat the invite they check
 *  for (the landing skip in signIn/signUp reads it, acceptance consumes it). */
export function peekPendingInvite(): InviteDeepLink | null {
  return pendingInvite;
}

export function clearPendingInvite(): void {
  pendingInvite = null;
}

// ---- Failure-message mapping -----------------------------------------------

/** Copy shown for an invitation the server will no longer accept. Shared with
 *  the arrival path, which shows it for a 404 preview or a non-pending status
 *  before any accept is attempted — the two must read identically, because to
 *  the person holding the link they are the same situation. */
export const INVITE_GONE_MESSAGE =
  "초대가 만료됐거나 이미 사용됐어요. 관리자에게 새 초대를 요청해 주세요.";

export interface AcceptInviteContext {
  /** The address the invitation was sent to, when we know it (from the
   *  preview). Null when we never got one — then the mismatch copy has to
   *  stay vague rather than name the wrong address. */
  inviteEmail: string | null;
  /** The address the app is signed in as. */
  sessionEmail: string | null;
}

/**
 * Turn an accept-invitation failure into something a person can act on.
 *
 * Better Auth's two messages here are both dead ends as written. "You are not
 * the recipient of the invitation" is really "you are signed in as the wrong
 * account", and the fix (sign out, or ask for an invite to this address) is
 * only obvious once both addresses are on screen next to each other.
 * "Invitation not found" covers expired, already-accepted and revoked alike —
 * we keep them merged, since the server deliberately doesn't distinguish them.
 *
 * Anything else keeps the server's own message: an unrecognised failure that
 * gets rewritten into friendly copy is a failure nobody can debug.
 */
export function acceptInviteFailureMessage(err: unknown, ctx: AcceptInviteContext): string {
  // A people limit at acceptance (the hard seat gate) speaks to the INVITEE:
  // they cannot buy seats, so the sentence says whom to ask.
  const limit = classifyLimitError(err);
  if (limit === "seat_limit") {
    return `${seatsFullCopy(seatLimitFromError(err)?.seats ?? null)} 초대한 사람에게 좌석을 추가해 달라고 요청한 뒤 다시 수락해 주세요.`;
  }
  if (limit === "member_limit") {
    return `${freePeopleIncluded(limitFromError(err) ?? 2)} 이 볼트는 가득 찼어요. 초대한 사람에게 Team으로 업그레이드해 달라고 요청한 뒤 다시 수락해 주세요.`;
  }
  if (limit === "read_only") {
    return "이 볼트의 구독이 끝나서 지금은 새 멤버를 받을 수 없어요. 초대한 사람에게 구독을 재개해 달라고 요청해 주세요.";
  }
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/not the recipient of the invitation/i.test(raw)) {
    const invited = ctx.inviteEmail;
    const current = ctx.sessionEmail;
    if (!invited || !current) {
      return "이 초대는 현재 로그인한 이메일과 다른 주소로 보내졌어요. 로그아웃한 뒤 초대받은 주소로 로그인하거나, 관리자에게 이 주소로 다시 초대해 달라고 요청해 주세요.";
    }
    return `이 초대는 ${invited}(으)로 보내졌지만 ${current}(으)로 로그인되어 있어요. 로그아웃한 뒤 ${invited}(으)로 로그인하거나, 관리자에게 ${current}(으)로 다시 초대해 달라고 요청해 주세요.`;
  }
  if (/invitation not found/i.test(raw)) return INVITE_GONE_MESSAGE;
  return raw || INVITE_GONE_MESSAGE;
}
