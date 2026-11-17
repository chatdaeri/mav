import { Hono } from "hono";
import { pool } from "../../db/pool.js";
import { auth, googleEnabled } from "../../auth/auth.js";
import { config } from "../../config.js";
import { orgRole } from "../../permissions/lookup.js";
import { getSession } from "../session.js";
import { setVaultBinding } from "../../mcp/oauth.js";
import { BRAND_NAME } from "../../brand.js";
import { emailEnabled } from "../../email/mailer.js";
import { esc, page } from "../pages.js";
import { VK_HEADER } from "../../crypto/transport.js";
import {
  completeConsent,
  consentFor,
  consentNeedsDesktop,
  openConsent,
  readyConsent,
  redirectHostsOf,
} from "../../mcp/oauth-consent.js";

/**
 * The human-facing pages of the MCP OAuth flow (the Better Auth `mcp` plugin
 * drives the machinery; these are the screens it redirects a browser through):
 *
 *   GET  /oauth/login    ← plugin's `loginPage`. Sign in to an existing account.
 *   GET  /oauth/consent  ← plugin's `consentPage`. Pick the vault + Allow.
 *   POST /oauth/consent  → records the vault binding, completes consent,
 *                          bounces back to the client's redirect_uri.
 *
 * Served by this (headless) server itself so the flow works on api.baalda.com
 * and any self-hoster with no separate web frontend. Page chrome + branding come
 * from ../pages.ts (shared with the account pages).
 */

const AUTHORIZE_PATH = "/api/auth/mcp/authorize";

async function clientName(clientId: string | undefined): Promise<string> {
  if (!clientId) return "외부 앱";
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM "oauthApplication" WHERE "clientId" = $1',
    [clientId],
  );
  return rows[0]?.name?.trim() || "외부 앱";
}

/** The client's registered redirect hosts: its name is self-chosen, the host is not. */
async function clientRedirectHosts(clientId: string | undefined): Promise<string[]> {
  if (!clientId) return [];
  const { rows } = await pool.query<{ redirect_urls: string | null }>(
    'SELECT "redirectUrls" AS redirect_urls FROM "oauthApplication" WHERE "clientId" = $1',
    [clientId],
  );
  return redirectHostsOf(rows[0]?.redirect_urls);
}

/** A soft pastel tile (fill + deeper letter of the same hue) that stays the same for a vault. */
function monogramStyle(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `background:hsl(${hue} 80% 93%);color:hsl(${hue} 45% 34%)`;
}

const ROLE_KO: Record<string, string> = { owner: "소유자", admin: "관리자", member: "멤버" };

/** The vault picker: a wide grid so a person in many vaults sees them at a glance. */
export function consentPage(opts: {
  app: string;
  email: string;
  consentCode: string;
  clientId: string;
  vaults: { id: string; name: string; role: string }[];
  preselect: string;
  redirectHosts?: string[];
}): string {
  const { app, email, consentCode, clientId, vaults, preselect } = opts;
  const hosts = opts.redirectHosts ?? [];
  const returnsTo = hosts.length
    ? `<p class="sub">승인하면 <b>${hosts.map(esc).join("</b>, <b>")}</b>(으)로 돌아가요. 해당 사이트에서 직접 시작한 경우에만 허용하세요.</p>`
    : "";
  const options = vaults
    .map((w) => {
      const initial = (w.name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?").toUpperCase();
      return `
      <label class="ws" data-name="${esc(w.name.toLowerCase())}">
        <input type="radio" name="organization_id" value="${esc(w.id)}" ${
          w.id === preselect ? "checked" : ""
        } required />
        <span class="ws-mono" style="${monogramStyle(w.id)}">${esc(initial)}</span>
        <span class="ws-meta"><span class="ws-name" title="${esc(w.name)}">${esc(
          w.name,
        )}</span><span class="ws-role">${esc(ROLE_KO[w.role] ?? w.role)}</span></span>
        <span class="ws-check" aria-hidden="true"></span>
      </label>`;
    })
    .join("");

  // A filter only earns its place once the grid no longer fits at a glance.
  const search =
    vaults.length > 8
      ? `<input type="search" class="ws-search" id="ws-search" placeholder="볼트 검색" autocomplete="off" />`
      : "";

  const body = `
    <h1><b>${esc(app)}</b>이(가) 접근을 요청해요</h1>
    <p class="sub"><b>${esc(email)}</b> 계정으로 로그인됨</p>
    ${returnsTo}
    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="consent_code" value="${esc(consentCode)}" />
      <input type="hidden" name="client_id" value="${esc(clientId)}" />
      <div class="ws-head">
        <label>연결할 볼트 선택<span class="count">${vaults.length}</span></label>
        ${search}
      </div>
      <div class="ws-grid" id="ws-grid">
        ${options}
        <p class="ws-empty" id="ws-empty" hidden>일치하는 볼트가 없어요.</p>
      </div>
      <div class="consent-foot">
        <div class="scopes"><ul>
          <li>접근할 수 있는 노트를 읽고 검색해요</li>
          <li>내 대신 노트를 만들고 편집하고 정리해요</li>
          <li>기존 공유 권한 범위 안에서만 동작해요</li>
        </ul></div>
        <div class="row">
          <button type="submit" name="decision" value="deny" class="ghost">거부</button>
          <button type="submit" name="decision" value="allow" class="primary">접근 허용</button>
        </div>
      </div>
    </form>
    <p class="foot">${esc(BRAND_NAME)} 볼트 설정에서 언제든 해제할 수 있어요.</p>
    <script>
      const checked = document.querySelector('.ws input:checked');
      if (checked) checked.closest('.ws').scrollIntoView({ block: 'nearest' });
      const q = document.getElementById('ws-search');
      if (q) q.addEventListener('input', () => {
        const term = q.value.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('#ws-grid .ws').forEach((el) => {
          const hit = !term || el.dataset.name.includes(term);
          el.hidden = !hit;
          if (hit) shown++;
        });
        document.getElementById('ws-empty').hidden = shown > 0;
      });
    </script>`;
  return page({ title: "권한 승인", body, wide: true });
}

/** "Open 마브 on your computer to finish connecting": a deep link into the
 *  desktop, then a poll that re-submits the consent once the desktop is done. */
export function finishInAppPage(opts: {
  app: string;
  consentId: string;
  consentCode: string;
  clientId: string;
  organizationId: string;
}): string {
  const link = `${config.deepLinkScheme}://oauth-consent?id=${encodeURIComponent(opts.consentId)}&server=${encodeURIComponent(config.betterAuthUrl)}`;
  const body = `
    <h1>컴퓨터의 ${esc(BRAND_NAME)}을 열어 연결을 마무리하세요</h1>
    <p class="sub">볼트 키는 내 기기에 있어서 <b>${esc(opts.app)}</b> 연결은 ${esc(
      BRAND_NAME,
    )} 앱에서 마무리해요. 이 페이지를 열어 두면 자동으로 이어져요.</p>
    <p><a class="btn primary" id="open-app" href="${esc(link)}">${esc(BRAND_NAME)} 열기</a></p>
    <form method="POST" action="/oauth/consent" id="finish">
      <input type="hidden" name="consent_code" value="${esc(opts.consentCode)}" />
      <input type="hidden" name="client_id" value="${esc(opts.clientId)}" />
      <input type="hidden" name="organization_id" value="${esc(opts.organizationId)}" />
      <input type="hidden" name="decision" value="allow" />
    </form>
    <p class="foot" id="state">${esc(BRAND_NAME)} 앱을 기다리는 중…</p>
    <script>
      const id = ${JSON.stringify(opts.consentId).replace(/</g, "\\u003c")};
      location.href = document.getElementById('open-app').href;
      const tick = async () => {
        try {
          const r = await fetch('/oauth/consent/status?id=' + encodeURIComponent(id), { credentials: 'same-origin' });
          const s = r.ok ? await r.json() : null;
          if (s && s.approved) { document.getElementById('finish').submit(); return; }
          if (r.status === 404) { document.getElementById('state').textContent = '요청이 만료됐어요. 앱에서 연결을 다시 시작하세요.'; return; }
        } catch {}
        setTimeout(tick, 2000);
      };
      setTimeout(tick, 2000);
    </script>`;
  return page({ title: "앱에서 마무리", body });
}

export const oauthConnectRoutes = new Hono();

// ── Desktop-completed consent (W3, rule 2) ──────────────────────────────────
// The browser page polls this (cookie session); the desktop reads and
// completes the consent (bearer session + X-Baalda-VK). Same user only.
oauthConnectRoutes.get("/oauth/consent/status", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Authentication required" }, 401);
  const view = await consentFor(c.req.query("id") ?? "", session.userId);
  if (!view) return c.json({ error: "Not found" }, 404);
  // No keyed vault (any more) behind it: the page may continue on its own.
  if (!view.approved && !(await consentNeedsDesktop(view.organizationId))) return c.json({ approved: true });
  return c.json({ approved: view.approved });
});

oauthConnectRoutes.get("/api/oauth/consents/:id", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Authentication required" }, 401);
  const view = await consentFor(c.req.param("id"), session.userId);
  if (!view) return c.json({ error: "This connection request expired or is not yours", code: "not_found" }, 404);
  return c.json(view);
});

oauthConnectRoutes.post("/api/oauth/consents/:id/complete", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Authentication required" }, 401);
  const result = await completeConsent(c.req.param("id"), session.userId, c.req.header(VK_HEADER));
  if (!result.ok) {
    return c.json(
      {
        error: result.code === "key_required" ? "This needs the vault's key from your device" : "This connection request expired or is not yours",
        code: result.code,
      },
      result.status,
    );
  }
  return c.json({ ok: true });
});

// ── Force the vault picker on every authorize (issue #211) ──────────────────
// The mcp plugin issues a code straight away unless prompt=consent, and a
// client whose user is already signed in in the browser never passes through
// /oauth/login (where we used to add it). Its token then had no vault binding
// and every call 401'd once the user belonged to two vaults. Mounted ahead of
// Better Auth's /api/auth/* handler, so this runs first.
oauthConnectRoutes.get(AUTHORIZE_PATH, async (c, next) => {
  const url = new URL(c.req.url);
  if (url.searchParams.get("prompt") === "consent") return next();
  url.searchParams.set("prompt", "consent");
  return c.redirect(`${config.betterAuthUrl}${AUTHORIZE_PATH}?${url.searchParams.toString()}`, 302);
});

// ── Sign-in page (Better Auth mcp plugin's loginPage) ───────────────────────
oauthConnectRoutes.get("/oauth/login", async (c) => {
  const url = new URL(c.req.url);
  const app = await clientName(url.searchParams.get("client_id") ?? undefined);
  // Re-enter authorize after sign-in with prompt=consent forced on. The Better
  // Auth `mcp` plugin only shows a consent screen (our vault picker) when
  // the request carries prompt=consent — clients like Claude don't send it, so
  // we add it ourselves here (the one point in the flow we control).
  const authorizeParams = new URLSearchParams(url.search);
  authorizeParams.set("prompt", "consent");
  const authorizeUrl = `${config.betterAuthUrl}${AUTHORIZE_PATH}?${authorizeParams.toString()}`;

  const google = googleEnabled
    ? `<div class="divider">또는</div>
       <button type="button" id="google" class="btn ghost">
         <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C17.1 2.9 14.8 2 12 2 6.9 2 2.8 6.1 2.8 11.2S6.9 20.4 12 20.4c6 0 7.9-4.2 7.9-7.5 0-.5-.1-.9-.2-1.3H12z"/></svg>
         Google로 계속
       </button>`
    : "";

  // Only when this server can actually send the email (issue #99); a link to a
  // reset flow that never delivers is worse than none.
  const forgot = emailEnabled()
    ? `<p class="linkline"><a href="/forgot-password">비밀번호를 잊으셨나요?</a></p>`
    : "";

  const body = `
    <h1>${esc(BRAND_NAME)} 로그인</h1>
    <p class="sub"><b>${esc(app)}</b> 연결을 위해 로그인하세요</p>
    <div id="err" class="err" style="display:none"></div>
    <form id="f" autocomplete="on">
      <label for="email">이메일</label>
      <input id="email" type="email" required autocomplete="username" autofocus />
      <label for="password">비밀번호</label>
      <input id="password" type="password" required autocomplete="current-password" />
      ${forgot}
      <button type="submit" class="primary">로그인</button>
    </form>
    ${google}
    <p class="foot"><b>${esc(app)}</b>이(가) 내 ${esc(BRAND_NAME)} 계정에 접근하도록 승인해요.</p>
    <script>
      const AUTHORIZE_URL = ${JSON.stringify(authorizeUrl)};
      const errEl = document.getElementById('err');
      function showErr(m){ errEl.textContent = m; errEl.style.display='block'; }
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.style.display='none';
        const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent='로그인 중…';
        try {
          // redirect:'manual' — on success the mcp plugin's after-hook tries to
          // auto-resume authorize and answers with a 3xx; we deliberately ignore
          // that (opaqueredirect) and drive the browser to authorize ourselves,
          // with prompt=consent, so the vault picker always shows.
          const res = await fetch('/api/auth/sign-in/email', {
            method:'POST', credentials:'include', redirect:'manual',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              email: document.getElementById('email').value,
              password: document.getElementById('password').value
            })
          });
          const ok = (res.status >= 200 && res.status < 300) || res.type === 'opaqueredirect' || res.status === 0;
          if (!ok) { const j = await res.json().catch(()=>({})); throw new Error(j.message || '이메일 또는 비밀번호가 올바르지 않아요'); }
          window.location.assign(AUTHORIZE_URL);
        } catch (err) {
          showErr(err.message || '로그인하지 못했어요'); btn.disabled=false; btn.textContent='로그인';
        }
      });
      const g = document.getElementById('google');
      if (g) g.addEventListener('click', async () => {
        g.disabled = true;
        try {
          const res = await fetch('/api/auth/sign-in/social', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ provider:'google', callbackURL: AUTHORIZE_URL })
          });
          const j = await res.json();
          if (j.url) window.location.assign(j.url); else throw new Error('Google 로그인을 시작하지 못했어요');
        } catch (err) { showErr(err.message || 'Google 로그인에 실패했어요'); g.disabled=false; }
      });
    </script>`;
  return c.html(page({ title: "로그인", body }));
});

// ── Consent page with vault picker (mcp plugin's consentPage) ───────────────
oauthConnectRoutes.get("/oauth/consent", async (c) => {
  const consentCode = c.req.query("consent_code") ?? "";
  const clientId = c.req.query("client_id") ?? "";
  const session = await getSession(c);
  if (!session) {
    return c.html(
      page({
        title: "세션 만료",
        body: `<h1>세션이 만료됐어요</h1><p class="sub">${esc(
          BRAND_NAME,
        )} 앱에서 연결을 다시 시작하세요.</p>`,
      }),
      400,
    );
  }
  if (!consentCode || !clientId) {
    return c.html(
      page({ title: "잘못된 요청", body: `<h1>잘못된 요청이에요</h1><p class="sub">승인 정보가 없어요.</p>` }),
      400,
    );
  }

  const app = await clientName(clientId);
  const { rows: vaults } = await pool.query<{ id: string; name: string; role: string }>(
    `SELECT o.id, o.name, m.role
       FROM member m JOIN organization o ON o.id = m."organizationId"
      WHERE m."userId" = $1
      ORDER BY o."createdAt" ASC`,
    [session.userId],
  );

  if (vaults.length === 0) {
    return c.html(
      page({
        title: "볼트 없음",
        body: `<h1>볼트가 없어요</h1><p class="sub">이 계정은 아직 ${esc(
          BRAND_NAME,
        )} 볼트의 멤버가 아니에요. 앱에서 볼트를 만들거나 참여한 뒤 다시 시도하세요.</p>`,
      }),
      400,
    );
  }

  return c.html(
    consentPage({
      app,
      email: session.email,
      consentCode,
      clientId,
      vaults,
      preselect: session.activeOrganizationId ?? vaults[0].id,
      redirectHosts: await clientRedirectHosts(clientId),
    }),
  );
});

oauthConnectRoutes.post("/oauth/consent", async (c) => {
  const form = await c.req.parseBody();
  const consentCode = typeof form.consent_code === "string" ? form.consent_code : "";
  const clientId = typeof form.client_id === "string" ? form.client_id : "";
  const organizationId =
    typeof form.organization_id === "string" ? form.organization_id : "";
  const accept = form.decision === "allow";

  const session = await getSession(c);
  if (!session) {
    return c.html(
      page({ title: "세션 만료", body: `<h1>세션이 만료됐어요</h1><p class="sub">연결을 다시 시작하세요.</p>` }),
      400,
    );
  }
  if (!consentCode) {
    return c.html(page({ title: "잘못된 요청", body: `<h1>잘못된 요청이에요</h1>` }), 400);
  }

  // On Allow: bind the chosen vault BEFORE completing consent, and only if
  // the user is really a member of it (the picker is user-supplied input).
  if (accept) {
    if (!organizationId || !(await orgRole(organizationId, session.userId))) {
      return c.html(
        page({
          title: "권한 승인",
          body: `<h1>볼트를 선택하세요</h1><p class="sub">내가 속한 볼트를 선택한 뒤 다시 시도하세요.</p>`,
        }),
        400,
      );
    }
    // A keyed vault: only the user's desktop can hand over the
    // vault key (security rule 2). Until it has, show the hand-off page; it
    // re-submits this same form once the desktop finished.
    if (await consentNeedsDesktop(organizationId)) {
      if (!(await readyConsent(session.userId, clientId, organizationId))) {
        const id = await openConsent(session.userId, clientId, organizationId);
        return c.html(
          finishInAppPage({
            app: await clientName(clientId),
            consentId: id,
            consentCode,
            clientId,
            organizationId,
          }),
        );
      }
    }
    await setVaultBinding(clientId, session.userId, organizationId);
  }

  try {
    const result = (await auth.api.oAuthConsent({
      body: { accept, consent_code: consentCode },
      headers: c.req.raw.headers,
    })) as { redirectURI?: string };
    if (result?.redirectURI) return c.redirect(result.redirectURI);
    throw new Error("no redirect");
  } catch {
    return c.html(
      page({
        title: "승인 실패",
        body: `<h1>승인하지 못했어요</h1><p class="sub">연결을 마무리하는 중 문제가 생겼어요. 앱에서 연결을 다시 시작하세요.</p>`,
      }),
      400,
    );
  }
});
