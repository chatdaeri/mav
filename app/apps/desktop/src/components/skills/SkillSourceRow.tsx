// The "Source" row on an imported skill's page: where it came from and, for
// admins, whether the upstream folder moved on, with Pull update. Checking
// costs two GitHub calls (commit + tree), so it runs once when the page opens
// and again only on Check again.

import { useCallback, useEffect, useState } from "react";
import { skillErrorCode } from "../../lib/api";
import { authManager } from "../../lib/auth/authManager";
import * as ipc from "../../lib/ipc";
import { fetchSkillFolder, loadOriginSkill, originOf, type MarketplaceSkill } from "../../lib/skills/marketplace";
import type { SkillOrigin } from "../../lib/skills/types";
import { skillDisplayName } from "../../lib/skills/display";
import { toast } from "../../lib/toast";
import { useStore } from "../../store";
import { Spinner } from "../Spinner";
import { readerFor } from "./MarketplaceBrowser";
import { BusyButton, GitHubGlyph, Tag } from "./parts";

type Check =
  | { status: "checking" }
  | { status: "current" }
  | { status: "update"; upstream: MarketplaceSkill }
  | { status: "gone" }
  | { status: "error"; message: string };

export function SkillSourceRow({
  orgId,
  skillId,
  skillName,
  source,
  canManage,
  onPulled,
}: {
  orgId: string;
  skillId: string;
  skillName: string;
  source: SkillOrigin;
  canManage: boolean;
  /** The draft now holds the upstream files. */
  onPulled: () => void;
}) {
  const serverUrl = useStore((s) => s.serverUrl);
  const [check, setCheck] = useState<Check | null>(null);

  const run = useCallback(async () => {
    setCheck({ status: "checking" });
    try {
      const upstream = await loadOriginSkill(await readerFor(serverUrl, orgId), source);
      if (!upstream) setCheck({ status: "gone" });
      else if (upstream.treeSha === source.treeSha) setCheck({ status: "current" });
      else setCheck({ status: "update", upstream });
    } catch (e) {
      setCheck({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [serverUrl, orgId, source]);

  // Re-check only when the recorded origin changes, not on every page reload
  // (each check spends two of GitHub's anonymous 60 requests an hour).
  const originKey = `${source.repo}|${source.ref}|${source.path}|${source.treeSha}`;
  useEffect(() => {
    if (canManage) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, originKey]);

  const pull = async (upstream: MarketplaceSkill) => {
    try {
      const files = await fetchSkillFolder(await readerFor(serverUrl, orgId), upstream);
      const detail = await authManager.api.getSkill(orgId, skillId);
      await authManager.api.putSkillDraft(orgId, skillId, detail.draftRevision, files, originOf(upstream));
      toast(`${skillDisplayName(skillName)}을(를) 초안으로 가져왔어요. 검토한 뒤 게시하세요.`);
      setCheck({ status: "current" });
      onPulled();
    } catch (e) {
      toast(
        skillErrorCode(e) === "stale_draft"
          ? `다른 사람이 ${skillName}의 초안을 바꿨어요. 다시 시도해 주세요.`
          : `${skillName}을(를) 가져오지 못했어요: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };

  const where = `${source.repo}${source.ref ? `@${source.ref}` : ""}`;
  const url = `https://github.com/${source.repo}/tree/${source.ref ?? source.commitSha}/${source.path}`;

  return (
    <div className="skills-source-strip">
      <span className="skills-source-where">
        <GitHubGlyph />
        <button className="link-btn skills-source-link" onClick={() => void ipc.openExternal(url)} title={url}>
          {where}
        </button>
        <span className="skills-mono"> · {source.path || "/"} · {source.commitSha.slice(0, 7)}</span>
      </span>
      {canManage && (
        <span className="skills-row-side">
          {check?.status === "checking" ? (
            <span className="field-hint skills-inline">
              <Spinner size="xs" /> 업데이트 확인 중…
            </span>
          ) : check?.status === "current" ? (
            <span className="field-hint">최신 상태</span>
          ) : check?.status === "update" ? (
            <>
              <Tag tone="warn">업데이트 있음</Tag>
              <BusyButton className="primary skills-btn-sm" busyLabel="가져오는 중…" onClick={() => pull(check.upstream)}>업데이트 가져오기</BusyButton>
            </>
          ) : check?.status === "gone" ? (
            <Tag tone="warn" title="저장소에서 이 폴더가 사라졌어요">원본에서 삭제됨</Tag>
          ) : check?.status === "error" ? (
            <>
              <span className="field-hint skills-hint-bad" title={check.message}>확인하지 못함</span>
              <button className="link-btn skills-source-link" onClick={() => void run()}>다시 시도</button>
            </>
          ) : null}
        </span>
      )}
    </div>
  );
}
