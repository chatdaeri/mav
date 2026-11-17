// Password-reset request outcomes → sentences a person can act on.
//
// The server (`POST /api/password-reset/request`) says exactly what happened
// rather than the usual neutral "if an account exists…", because in practice
// that sentence hid the two things that actually go wrong: the address has no
// account on THIS server (they signed up elsewhere, or with another email), or
// the mail provider refused the message. Each gets its own line here.

import { ApiError } from "./api";

export interface ResetFailureContext {
  email: string;
  /** Host of the server the request went to, e.g. "api.baalda.com". */
  serverHost: string;
}

function errorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const code = (err.body as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return null;
}

function serverMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const m = (err.body as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return null;
}

export function passwordResetFailureMessage(err: unknown, ctx: ResetFailureContext): string {
  const code = errorCode(err);
  if (code === "no_account" || (err instanceof ApiError && err.status === 404)) {
    return `${ctx.serverHost}에 ${ctx.email} 계정이 없어요. 주소(팀에서 서버를 직접 운영한다면 서버)를 확인하거나 가입해 주세요.`;
  }
  if (code === "send_failed") {
    return `재설정 이메일을 보내지 못했어요. ${serverMessage(err) ?? ""} 잠시 후 다시 시도하거나 서버 운영자에게 문의해 주세요.`.replace(/\s+/g, " ");
  }
  if (code === "too_many_requests") {
    return serverMessage(err) ?? "이 주소로 재설정 요청이 너무 많아요. 한 시간 뒤에 다시 시도해 주세요.";
  }
  if (code === "email_not_configured") {
    return "이 서버는 이메일을 보낼 수 없어서 여기서 비밀번호를 재설정할 수 없어요. 서버 운영자에게 새 비밀번호 설정을 요청해 주세요.";
  }
  return err instanceof Error && err.message ? err.message : "재설정을 요청하지 못했어요.";
}
