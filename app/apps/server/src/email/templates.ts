import { BRAND_NAME } from "../brand.js";
import type { MailMessage } from "./mailer.js";

/**
 * The transactional emails the server sends. Deliberately plain: inline
 * styles only, one column, a light background and a single black button —
 * what renders identically in Gmail, Outlook and Apple Mail, and what lands in
 * the inbox rather than the promotions tab. The plain-text twin is not an
 * afterthought: some clients prefer it, and every link must be copy-pasteable
 * from it.
 *
 * Every dynamic value goes through `esc` before it touches HTML. Org names and
 * inviter names are user-supplied.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * One-column shell. The button and the "paste this link" fallback render only
 * when there is a link to press — notification emails (a member left) have
 * nothing to click and say so by leaving `cta`/`url` off.
 */
function layout(opts: {
  title: string;
  intro: string;
  cta?: string;
  url?: string;
  outro: string;
}): string {
  const button =
    opts.cta && opts.url
      ? `<p style="margin:0 0 22px;">
        <a href="${esc(opts.url)}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px;">${esc(opts.cta)}</a>
      </p>
      `
      : "";
  const fallback = opts.url
    ? `
      <p style="font-size:12px;line-height:1.5;margin:18px 0 0;color:#8a8a84;word-break:break-all;">버튼이 동작하지 않으면 이 링크를 브라우저에 붙여넣으세요.<br /><a href="${esc(opts.url)}" style="color:#6b6b66;">${esc(opts.url)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="ko">
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px;">
    <div style="font-weight:700;letter-spacing:0.18em;font-size:13px;color:#6b6b66;margin-bottom:22px;">${esc(BRAND_NAME.toUpperCase())}</div>
    <div style="background:#ffffff;border:1px solid #e6e5df;border-radius:14px;padding:30px 28px;">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">${opts.title}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 22px;color:#3a3a37;">${opts.intro}</p>
      ${button}<p style="font-size:13px;line-height:1.55;margin:0;color:#6b6b66;">${opts.outro}</p>${fallback}
    </div>
  </div>
</body>
</html>`;
}

export function resetPasswordEmail(input: { to: string; url: string; validMinutes: number }): MailMessage {
  const subject = `${BRAND_NAME} 비밀번호 재설정`;
  const text = [
    `${BRAND_NAME} 계정 ${input.to}의 비밀번호 재설정 요청이 있었어요.`,
    ``,
    `아래 링크에서 새 비밀번호를 정하세요. 링크는 ${input.validMinutes}분 동안 유효해요.`,
    input.url,
    ``,
    `요청한 적이 없다면 이 메일을 무시하세요. 비밀번호는 그대로 유지돼요.`,
  ].join("\n");
  const html = layout({
    title: "비밀번호 재설정",
    intro: `${esc(BRAND_NAME)} 계정 <b>${esc(input.to)}</b>의 비밀번호 재설정 요청이 있었어요. 아래에서 새 비밀번호를 정하세요. 링크는 ${input.validMinutes}분 동안 유효해요.`,
    cta: "새 비밀번호 정하기",
    url: input.url,
    outro: `요청한 적이 없다면 이 메일을 무시하세요. 비밀번호는 그대로 유지돼요.`,
  });
  return { to: input.to, subject, text, html };
}

export function verifyEmailEmail(input: { to: string; url: string }): MailMessage {
  const subject = `${BRAND_NAME} 이메일 확인`;
  const text = [
    `${BRAND_NAME}에 오신 것을 환영해요. ${input.to} 주소가 본인 것인지 확인해 주세요.`,
    input.url,
    ``,
    `${BRAND_NAME} 계정을 만든 적이 없다면 이 메일을 무시하세요.`,
  ].join("\n");
  const html = layout({
    title: "이메일 확인",
    intro: `${esc(BRAND_NAME)}에 오신 것을 환영해요. <b>${esc(input.to)}</b> 주소가 본인 것인지 확인해 주세요.`,
    cta: "이메일 확인",
    url: input.url,
    outro: `${esc(BRAND_NAME)} 계정을 만든 적이 없다면 이 메일을 무시하세요.`,
  });
  return { to: input.to, subject, text, html };
}

export function invitationEmail(input: {
  to: string;
  url: string;
  organizationName: string;
  inviterName: string | null;
  role: string;
  expiresAt: Date;
}): MailMessage {
  const who = input.inviterName?.trim() || "팀원";
  const subject = `${who}님이 ${BRAND_NAME}에서 ${input.organizationName} 볼트에 초대했어요`;
  const roleNote = input.role === "admin" ? " 관리자로" : "";
  const expires = input.expiresAt.toUTCString();
  const text = [
    `${who}님이 ${BRAND_NAME}의 "${input.organizationName}" 볼트에${roleNote} 초대했어요.`,
    ``,
    `아래 링크에서 초대를 수락하세요.`,
    input.url,
    ``,
    `${input.to} 주소로 로그인하거나 가입하면 바로 볼트로 이동해요.`,
    `이 초대는 ${expires}에 만료돼요.`,
    ``,
    `아직 ${BRAND_NAME}이 없나요? https://github.com/chatdaeri/mav 에서 받은 뒤 링크를 다시 열어 주세요.`,
  ].join("\n");
  const html = layout({
    title: `${esc(input.organizationName)} 볼트 참여`,
    intro: `<b>${esc(who)}</b>님이 ${esc(BRAND_NAME)}의 <b>${esc(input.organizationName)}</b> 볼트에${esc(roleNote)} 초대했어요. <b>${esc(input.to)}</b> 주소로 로그인하거나 가입하면 바로 볼트로 이동해요.`,
    cta: "초대 수락",
    url: input.url,
    outro: `이 초대는 ${esc(expires)}에 만료돼요. 아직 ${esc(BRAND_NAME)}이 없나요? <a href="https://github.com/chatdaeri/mav" style="color:#6b6b66;">받기</a> 후 링크를 다시 열어 주세요.`,
  });
  return { to: input.to, subject, text, html };
}

/**
 * The one reminder an invitee gets about a day before their invitation runs
 * out (#268, `invitations/sweep.ts`). Same link as the original — the
 * invitation itself is unchanged; this only says it is about to expire.
 */
export function invitationReminderEmail(input: {
  to: string;
  url: string;
  organizationName: string;
  inviterName: string | null;
  expiresAt: Date;
}): MailMessage {
  const inviter = input.inviterName?.trim() || null;
  const who = inviter ?? "팀원";
  const askWho = inviter ?? "초대한 사람";
  const subject = `알림: ${input.organizationName} 볼트 초대가 곧 만료돼요`;
  const expires = input.expiresAt.toUTCString();
  const text = [
    `${who}님이 ${BRAND_NAME}의 "${input.organizationName}" 볼트에 초대했고, 이 초대는 ${expires}에 만료돼요.`,
    ``,
    `그 전에 아래 링크에서 수락하세요.`,
    input.url,
    ``,
    `${input.to} 주소로 로그인하거나 가입하면 바로 볼트로 이동해요.`,
    `만료된 뒤에는 ${askWho}에게 새 초대를 요청하세요.`,
  ].join("\n");
  const html = layout({
    title: `${esc(input.organizationName)} 볼트 초대가 곧 만료돼요`,
    intro: `<b>${esc(who)}</b>님이 ${esc(BRAND_NAME)}의 <b>${esc(input.organizationName)}</b> 볼트에 초대했어요. <b>${esc(input.to)}</b> 주소로 로그인하거나 가입하면 바로 볼트로 이동해요.`,
    cta: "초대 수락",
    url: input.url,
    outro: `이 초대는 ${esc(expires)}에 만료돼요. 만료된 뒤에는 ${esc(askWho)}에게 새 초대를 요청하세요.`,
  });
  return { to: input.to, subject, text, html };
}

/**
 * To a vault's owner when a member leaves on their own (#121). Purely
 * informational — there is nothing for the owner to do — so no button. Names
 * the shares that were dropped, because that is the one side effect the owner
 * might otherwise go looking for.
 */
export function memberLeftEmail(input: {
  to: string;
  organizationName: string;
  memberName: string | null;
  memberEmail: string;
}): MailMessage {
  const who = input.memberName?.trim() || input.memberEmail;
  const subject = `${who}님이 ${input.organizationName} 볼트를 나갔어요`;
  const text = [
    `${who}님(${input.memberEmail})이 ${BRAND_NAME}의 "${input.organizationName}" 볼트를 나갔어요.`,
    ``,
    `더 이상 이 볼트의 노트에 접근할 수 없고, 직접 공유했던 폴더와 파일은 공유가 해제됐어요.`,
    ``,
    `예상하지 못한 일이라면 볼트의 멤버 페이지에서 다시 초대할 수 있어요.`,
  ].join("\n");
  const html = layout({
    title: `${esc(who)}님이 ${esc(input.organizationName)} 볼트를 나갔어요`,
    intro: `<b>${esc(who)}</b>님(${esc(input.memberEmail)})이 ${esc(BRAND_NAME)}의 <b>${esc(input.organizationName)}</b> 볼트를 나갔어요. 더 이상 이 볼트의 노트에 접근할 수 없고, 직접 공유했던 폴더와 파일은 공유가 해제됐어요.`,
    outro: `예상하지 못한 일이라면 볼트의 멤버 페이지에서 다시 초대할 수 있어요.`,
  });
  return { to: input.to, subject, text, html };
}

/**
 * To the person who left, as a receipt (#121). Says where the vault went on
 * their devices — removed, not kept — and how to come back.
 */
export function youLeftVaultEmail(input: { to: string; organizationName: string }): MailMessage {
  const subject = `${input.organizationName} 볼트에서 나갔어요`;
  const text = [
    `${BRAND_NAME}의 "${input.organizationName}" 볼트에서 나갔어요.`,
    ``,
    `내 기기에서 볼트가 삭제됐고, 더 이상 노트에 접근할 수 없어요.`,
    `다시 참여하려면 볼트 소유자에게 새 초대나 참여 코드를 요청하세요.`,
    ``,
    `직접 한 일이 아니라면 바로 비밀번호를 바꾸세요. 다른 사람이 계정에 접근했을 수 있어요.`,
  ].join("\n");
  const html = layout({
    title: `${esc(input.organizationName)} 볼트에서 나갔어요`,
    intro: `${esc(BRAND_NAME)}의 <b>${esc(input.organizationName)}</b> 볼트에서 나갔어요. 내 기기에서 볼트가 삭제됐고, 더 이상 노트에 접근할 수 없어요. 다시 참여하려면 볼트 소유자에게 새 초대나 참여 코드를 요청하세요.`,
    outro: `직접 한 일이 아니라면 바로 비밀번호를 바꾸세요. 다른 사람이 계정에 접근했을 수 있어요.`,
  });
  return { to: input.to, subject, text, html };
}

/**
 * A bug report from the desktop's "Report a bug" dialog, to the operator's
 * `BUG_REPORT_EMAIL`. Reply-To is the reporter, so answering is one click.
 * Everything in it is user-supplied and escaped; the body keeps its own line
 * breaks.
 */
export function bugReportEmail(input: {
  to: string;
  reporter: { email: string; name?: string | null };
  message: string;
  details: ReadonlyArray<[string, string]>;
  /** A Loom / screen-recording link, already validated as http(s). */
  videoUrl?: string;
  attachments?: MailMessage["attachments"];
}): MailMessage {
  const who = input.reporter.name ? `${input.reporter.name} <${input.reporter.email}>` : input.reporter.email;
  const firstLine = input.message.split("\n")[0]!.trim();
  const summary = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  const detailText = input.details.map(([k, v]) => `${k}: ${v}`).join("\n");
  const detailHtml = input.details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#8a8a84;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:2px 0;color:#3a3a37;word-break:break-all;">${esc(v)}</td></tr>`,
    )
    .join("");
  const files = input.attachments ?? [];
  const filesLine = files.length ? `첨부 ${files.length}개: ${files.map((f) => f.filename).join(", ")}` : "";
  return {
    to: input.to,
    replyTo: input.reporter.email,
    subject: `버그 제보: ${summary}`,
    ...(files.length ? { attachments: files } : {}),
    text: `${who}님의 버그 제보\n\n${input.message}\n${input.videoUrl ? `\n영상: ${input.videoUrl}\n` : ""}${
      filesLine ? `\n${filesLine}\n` : ""
    }${detailText ? `\n---\n${detailText}\n` : ""}`,
    html: `<!doctype html>
<html lang="ko">
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-weight:700;letter-spacing:0.18em;font-size:13px;color:#6b6b66;margin-bottom:18px;">${esc(BRAND_NAME.toUpperCase())} · 버그 제보</div>
    <div style="background:#ffffff;border:1px solid #e6e5df;border-radius:14px;padding:26px 24px;">
      <p style="font-size:13px;margin:0 0 14px;color:#6b6b66;">보낸 사람: ${esc(who)}. 이 메일에 답장하면 제보자에게 전달돼요.</p>
      <div style="font-size:15px;line-height:1.55;color:#1c1c1a;white-space:pre-wrap;">${esc(input.message)}</div>${
        input.videoUrl
          ? `
      <p style="margin:16px 0 0;font-size:14px;"><a href="${esc(input.videoUrl)}" style="color:#7c5cff;">녹화 영상 보기</a> <span style="color:#8a8a84;word-break:break-all;">${esc(input.videoUrl)}</span></p>`
          : ""
      }${
        filesLine
          ? `
      <p style="margin:12px 0 0;font-size:13px;color:#6b6b66;">📎 ${esc(filesLine)}</p>`
          : ""
      }${
        detailHtml
          ? `
      <table style="margin-top:20px;padding-top:14px;border-top:1px solid #eeede8;font-size:12px;line-height:1.5;width:100%;border-collapse:collapse;">${detailHtml}</table>`
          : ""
      }
    </div>
  </div>
</body>
</html>`,
  };
}
