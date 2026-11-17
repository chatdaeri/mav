import { Hono } from "hono";
import { pool } from "../../db/pool.js";
import { BRAND_NAME } from "../../brand.js";
import { config } from "../../config.js";
import { emailEnabled } from "../../email/mailer.js";
import { esc, page } from "../pages.js";
import { publicBaseUrl } from "./open-link.js";
import { invitationState, loadInvitation } from "../../registry/invitations.js";

/**
 * Account pages served by this (headless) server (issue #99) — the human side
 * of the email flows, on the same branded chrome as the MCP OAuth screens so
 * they work on api.baalda.com and on any self-host with no web frontend:
 *
 *   GET /forgot-password         ask for the reset email (linked from /oauth/login)
 *   GET /reset-password?token=…  choose a new password (the emailed link), then
 *                                bounces into `mav://signin`
 *   GET /email-verified          where the verification link lands; bounces into
 *                                `mav://verified` so the app refreshes itself
 *   GET /invite/:id              where an invitation email lands: bounces into
 *                                the desktop app's `mav://invite/…` deep link
 *
 * All four are public. The reset page's token is single-use and expires in an
 * hour (Better Auth's `reset-password:<token>` verification row); the invite
 * page shows only what the email that carried the id already said.
 */
export const accountPageRoutes = new Hono();

/** Better Auth ids (and anything else we'd put in a URL): one conservative shape. */
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Deep links back into the desktop app (`lib/accountLink.ts` on the desktop
 * side); the scheme is `DEEP_LINK_SCHEME` (staging apps register their own).
 * Neither carries data: `verified` makes the app re-read its session so
 * the verified state appears without a reload; `signin` makes it re-check the
 * (now revoked) session and open the sign-in card.
 */
const VERIFIED_DEEP_LINK = `${config.deepLinkScheme}://verified`;
const SIGNIN_DEEP_LINK = `${config.deepLinkScheme}://signin`;

function notAvailable() {
  return page({
    title: "사용할 수 없음",
    body: `<h1>사용할 수 없어요</h1><p class="sub">이 ${esc(
      BRAND_NAME,
    )} 서버는 이메일을 보내지 않아서 여기서는 비밀번호를 재설정할 수 없어요. 서버 운영자에게 이메일 발송 설정(배포 가이드 참고)이나 새 비밀번호 설정을 요청하세요.</p>`,
  });
}

// ── Forgot password ──────────────────────────────────────────────────────────
accountPageRoutes.get("/forgot-password", (c) => {
  if (!emailEnabled()) return c.html(notAvailable(), 404);
  const body = `
    <h1>비밀번호 재설정</h1>
    <p class="sub">이메일을 입력하면 새 비밀번호를 정할 수 있는 링크를 보내드려요.</p>
    <div id="err" class="err" style="display:none"></div>
    <form id="f" autocomplete="on">
      <label for="email">이메일</label>
      <input id="email" type="email" required autocomplete="username" autofocus />
      <button type="submit" class="primary">재설정 링크 받기</button>
    </form>
    <div id="done" style="display:none">
      <div class="ok"><b id="who"></b> 주소로 재설정 링크를 보냈어요. 받은편지함(스팸함 포함)을 확인하세요. 링크는 1시간 동안 유효해요.</div>
    </div>
    <p class="foot"><a class="plain" href="/oauth/login">로그인으로 돌아가기</a></p>
    <script>
      const errEl = document.getElementById('err');
      function showErr(m){ errEl.textContent = m; errEl.style.display='block'; }
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.style.display='none';
        const form = e.target; const btn = form.querySelector('button');
        const email = document.getElementById('email').value.trim();
        btn.disabled = true; btn.textContent = '보내는 중…';
        try {
          const res = await fetch('/api/password-reset/request', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ email })
          });
          if (!res.ok) {
            const j = await res.json().catch(()=>({}));
            if (j.error === 'no_account') throw new Error('이 서버에 ' + email + ' 계정이 없어요. 주소를 확인하세요(팀에서 서버를 따로 운영한다면 서버도 확인하세요).');
            throw new Error(j.message || '이메일을 보내지 못했어요');
          }
          document.getElementById('who').textContent = email;
          form.style.display = 'none';
          document.getElementById('done').style.display = 'block';
        } catch (err) {
          showErr(err.message || '이메일을 보내지 못했어요'); btn.disabled=false; btn.textContent='재설정 링크 받기';
        }
      });
    </script>`;
  return c.html(page({ title: "비밀번호 재설정", body }));
});

// ── Reset password (the emailed link) ────────────────────────────────────────
accountPageRoutes.get("/reset-password", (c) => {
  const token = c.req.query("token") ?? "";
  if (!ID_RE.test(token)) {
    return c.html(
      page({
        title: "잘못된 링크",
        body: `<h1>유효하지 않은 링크예요</h1><p class="sub">${esc(
          BRAND_NAME,
        )} 앱에서 새 재설정 링크를 요청하세요(로그인 → 비밀번호를 잊으셨나요?).</p>`,
      }),
      400,
    );
  }
  const body = `
    <h1>새 비밀번호 정하기</h1>
    <p class="sub">8자 이상으로 정하세요. 이 계정에 로그인된 다른 기기는 모두 로그아웃돼요.</p>
    <div id="err" class="err" style="display:none"></div>
    <form id="f" autocomplete="on">
      <label for="pw">새 비밀번호</label>
      <input id="pw" type="password" required minlength="8" autocomplete="new-password" autofocus />
      <label for="pw2">새 비밀번호 확인</label>
      <input id="pw2" type="password" required minlength="8" autocomplete="new-password" />
      <button type="submit" class="primary">새 비밀번호 저장</button>
    </form>
    <div id="done" style="display:none">
      <div class="ok">비밀번호를 바꿨어요. ${esc(BRAND_NAME)}을 열어 새 비밀번호로 로그인하세요…</div>
      <a class="btn primary" href="${esc(SIGNIN_DEEP_LINK)}" style="display:flex;text-decoration:none">${esc(
        BRAND_NAME,
      )} 열기</a>
    </div>
    <script>
      const TOKEN = ${JSON.stringify(token)};
      const SIGNIN = ${JSON.stringify(SIGNIN_DEEP_LINK)};
      const errEl = document.getElementById('err');
      function showErr(m){ errEl.textContent = m; errEl.style.display='block'; }
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.style.display='none';
        const pw = document.getElementById('pw').value, pw2 = document.getElementById('pw2').value;
        if (pw !== pw2) { showErr('비밀번호가 서로 달라요.'); return; }
        const form = e.target; const btn = form.querySelector('button');
        btn.disabled = true; btn.textContent = '저장 중…';
        try {
          const res = await fetch('/api/auth/reset-password', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ newPassword: pw, token: TOKEN })
          });
          if (!res.ok) {
            const j = await res.json().catch(()=>({}));
            const code = j.code || '';
            if (code === 'INVALID_TOKEN' || /invalid token/i.test(j.message || '')) {
              throw new Error('링크가 만료됐거나 이미 사용됐어요. 앱에서 새 링크를 요청하세요.');
            }
            throw new Error(j.message || '비밀번호를 바꾸지 못했어요');
          }
          form.style.display = 'none';
          document.getElementById('done').style.display = 'block';
          // Hand off to the app, which re-checks its session (revoked by the
          // reset) and opens the sign-in card. The button stays as the fallback.
          setTimeout(() => { location.href = SIGNIN; }, 600);
        } catch (err) {
          showErr(err.message || '비밀번호를 바꾸지 못했어요'); btn.disabled=false; btn.textContent='새 비밀번호 저장';
        }
      });
    </script>`;
  return c.html(page({ title: "새 비밀번호 정하기", body }));
});

// ── Email verified (verification link callback) ──────────────────────────────
accountPageRoutes.get("/email-verified", (c) => {
  const error = c.req.query("error");
  if (error) {
    return c.html(
      page({
        title: "링크 만료",
        body: `<h1>링크가 만료됐어요</h1><p class="sub">${esc(
          BRAND_NAME,
        )}에 로그인하면 확인 메일을 다시 보내드려요.</p>`,
      }),
      400,
    );
  }
  // Same hand-off as the invite page: bounce into the app, which refreshes its
  // session so the verified state shows without a reload; button as fallback.
  return c.html(
    page({
      title: "이메일 확인 완료",
      body: `<h1>이메일을 확인했어요</h1><p class="sub">주소 인증이 끝났어요. ${esc(
        BRAND_NAME,
      )}(으)로 돌아가는 중…</p>
      <a class="btn primary" href="${esc(VERIFIED_DEEP_LINK)}" style="display:flex;text-decoration:none">${esc(
        BRAND_NAME,
      )} 열기</a>
      <script>location.href = ${JSON.stringify(VERIFIED_DEEP_LINK)};</script>`,
    }),
  );
});

/**
 * Seamless keys B5: the invite secret arrives in the link's FRAGMENT (`#k=`),
 * which a browser never sends to the server. This script, run in the browser,
 * copies a well-formed one onto the app deep link as `&k=` (button and
 * auto-redirect) and strips it from the address bar. The server-rendered HTML
 * never contains the secret.
 */
function inviteHandOffScript(deepLink: string): string {
  return `(function () {
  var link = ${JSON.stringify(deepLink)};
  try {
    var m = /(?:^#|&)k=([0-9A-HJKMNP-TV-Z]{26})(?:&|$)/.exec(location.hash || "");
    if (m) {
      link += "&k=" + m[1];
      var a = document.getElementById("open-invite");
      if (a) a.setAttribute("href", link);
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    }
  } catch (e) {}
  location.href = link;
})();`;
}

// ── Invitation landing page ──────────────────────────────────────────────────
accountPageRoutes.get("/invite/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.text("잘못된 링크예요", 400);

  const inv = await loadInvitation(pool, id);
  if (!inv) {
    return c.html(
      page({
        title: "초대를 찾을 수 없음",
        body: `<h1>초대를 찾을 수 없어요</h1><p class="sub">이 링크에 해당하는 초대가 없어요. 초대한 사람에게 새 초대를 요청하세요.</p>`,
      }),
      404,
    );
  }
  const state = invitationState(inv);
  if (state !== "pending") {
    const why =
      state === "expired"
        ? "초대가 만료됐어요."
        : state === "accepted"
          ? "이미 수락한 초대예요."
          : "초대가 취소됐어요.";
    return c.html(
      page({
        title: "초대를 사용할 수 없음",
        body: `<h1>${esc(why)}</h1><p class="sub"><b>${esc(
          inv.organizationName,
        )}</b> 볼트에 초대한 사람에게 새 초대를 요청하세요${state === "accepted" ? ". 이미 멤버일 수 있으니 로그인해 보세요" : ""}.</p>`,
      }),
      410,
    );
  }

  const server = publicBaseUrl(c);
  const deepLink = `${config.deepLinkScheme}://invite/${encodeURIComponent(id)}?server=${encodeURIComponent(server)}`;
  const who = inv.inviterName?.trim() || "팀원";
  const body = `
    <h1>${esc(inv.organizationName)} 볼트 참여</h1>
    <p class="sub"><b>${esc(who)}</b>님이 <b>${esc(inv.email)}</b> 주소를 이 볼트에${
      inv.role === "admin" ? " 관리자로" : ""
    } 초대했어요.</p>
    <a id="open-invite" class="btn primary" href="${esc(deepLink)}" style="display:flex;text-decoration:none">${esc(
      BRAND_NAME,
    )}에서 열기</a>
    <p class="sub" style="margin-top:18px"><b>${esc(
      inv.email,
    )}</b> 주소로 로그인하거나 가입하면 바로 볼트로 이동해요.</p>
    <p class="foot">아직 ${esc(BRAND_NAME)}이 없나요? <a href="https://github.com/chatdaeri/mav" rel="noopener">받기</a> 후 이 링크를 다시 열어 주세요.</p>
    <script>${inviteHandOffScript(deepLink)}</script>`;
  return c.html(page({ title: `${inv.organizationName} 볼트 참여`, body }));
});
