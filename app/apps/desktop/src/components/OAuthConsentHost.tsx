import { useEffect, useState } from "react";
import type { OAuthConsentRequest } from "../lib/api";
import { authManager } from "../lib/auth/authManager";
import { consentKeyHeader, linkMatchesServer } from "../lib/oauthConsentLink";
import { toast } from "../lib/toast";
import { orgOfVault } from "../lib/vaultKeys/forget";
import { useStore } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Finishes a claude.ai / ChatGPT connection to a keyed vault (W3, security
 * rule 2), raised by a `mav://oauth-consent` link from the server's consent
 * page. Reads the request from the signed-in server, asks the person, and only
 * on their click presents the vault key. The browser page then continues on
 * its own.
 */
export function OAuthConsentHost() {
  const link = useStore((s) => s.oauthConsentLink);
  const serverUrl = useStore((s) => s.serverUrl);
  const signedIn = useStore((s) => s.authStatus === "signed-in");
  const [request, setRequest] = useState<OAuthConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRequest(null);
    setError(null);
    if (!link) return;
    if (!signedIn) {
      setError("마이 세컨드 브레인에 로그인한 뒤 연결을 다시 시작해 주세요.");
      return;
    }
    if (!linkMatchesServer(link, serverUrl)) {
      setError("이 연결 요청은 이 앱이 쓰는 서버가 아닌 다른 마이 세컨드 브레인 서버용이에요.");
      return;
    }
    let live = true;
    authManager.api
      .getOAuthConsent(link.id)
      .then((r) => live && setRequest(r))
      .catch(() => live && setError("연결 요청이 만료됐거나 다른 계정의 요청이에요. 다시 시작해 주세요."));
    return () => {
      live = false;
    };
  }, [link, serverUrl, signedIn]);

  if (!link) return null;
  const close = () => useStore.getState().clearOAuthConsent();

  if (error) {
    return (
      <ConfirmDialog title="연결을 완료하지 못했어요" confirmLabel="확인" tone="accent" onConfirm={close} onCancel={close}>
        <p>{error}</p>
      </ConfirmDialog>
    );
  }
  if (!request) return null;

  const allow = async () => {
    const userId = useStore.getState().session?.user.id ?? "";
    const base = authManager.api.getBaseUrl();
    const header = await consentKeyHeader(request.vaultIds, authManager.api, (id) => {
      const org = orgOfVault(base, userId, id);
      return org !== null && org !== request.organizationId;
    });
    if (!header) {
      toast(`이 컴퓨터에는 ${request.vaultName || "이 볼트"}의 키가 아직 없어요.`, "error");
      return;
    }
    await authManager.api.completeOAuthConsent(request.id, header);
    toast(`${request.app} 연결을 완료했어요: ${request.vaultName || "내 볼트"}.`, "success");
    close();
  };

  return (
    <ConfirmDialog
      title={`${request.app} 연결할까요?`}
      confirmLabel="접근 허용"
      tone="accent"
      onConfirm={allow}
      onCancel={close}
    >
      <ConsentPromptBody request={request} />
    </ConfirmDialog>
  );
}

/**
 * What the person is agreeing to. The app name is whatever the connector's
 * registrant typed (anyone can register a client called "Claude"), so the
 * place it sends people back to is shown beside it.
 */
export function ConsentPromptBody({ request }: { request: OAuthConsentRequest }) {
  const hosts = (Array.isArray(request.redirectHosts) ? request.redirectHosts : [])
    .filter((h): h is string => typeof h === "string" && h.length > 0)
    .slice(0, 5);
  return (
    <>
      <p>
        <b>{request.app}</b>에 <b>{request.vaultName || "내 볼트"}</b>의 노트를 읽고 편집할 권한을 줘요. 내
        기존 권한 범위 안에서만 가능하고, 이 컴퓨터가 꺼져 있어도 계속 동작해요.
      </p>
      {hosts.length > 0 ? (
        <p>
          연결 후 돌아가는 주소: <b>{hosts.join(", ")}</b>. 직접 그곳에서 연결을 시작했을 때만 허용하세요.
        </p>
      ) : (
        <p>방금 직접 연결을 시작했을 때만 허용하세요.</p>
      )}
    </>
  );
}
