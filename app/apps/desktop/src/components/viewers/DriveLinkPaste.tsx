// 마브: a video, or a file over 25MB, never uploads — the team server's
// Postgres store refuses it (see `formats.ts isLocalOnlyBinary`). This box,
// shown on the file card, lets the owner share it the agreed way instead: put
// the file on Google Drive and paste the share link. A `<name> (드라이브 링크).url`
// file is written next to it; `.url` is a small note-family file, so it syncs
// and opens the Drive link for every teammate.

import { useEffect, useState } from "react";
import { internetShortcut } from "../../lib/dashboard/links";
import { isLocalOnlyBinary } from "../../lib/formats";
import * as ipc from "../../lib/ipc";
import { useStore } from "../../store";

/** `폴더/영상.mp4` → `폴더/영상 (드라이브 링크).url` */
export function driveLinkPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem} (드라이브 링크).url`;
}

export function DriveLinkPaste({ path, size }: { path: string; size: number | null }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (size == null || !isLocalOnlyBinary(path, size)) return null;

  const create = async () => {
    setMsg(null);
    let body: string;
    try {
      body = internetShortcut(url);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "링크를 확인해 주세요." });
      return;
    }
    const target = driveLinkPath(path);
    try {
      const created = await ipc.writeNoteIfMissing(target, body, useStore.getState().vault?.epoch);
      setMsg(
        created
          ? { ok: true, text: `${target.split("/").pop()} 파일을 만들었어요. 팀원도 이 파일로 드라이브에서 열 수 있어요.` }
          : { ok: false, text: "같은 이름의 링크 파일이 이미 있어요." },
      );
    } catch (e) {
      console.error("drive link write failed", e);
      setMsg({ ok: false, text: "링크 파일을 만들지 못했어요." });
    }
  };

  return (
    <div className="drive-link-paste">
      <p className="drive-link-lede">
        영상이거나 25MB가 넘는 파일이라 서버에 올리지 않고 이 기기에만 있어요. 구글 드라이브에 올린 뒤 공유
        링크를 붙여 넣으면 팀원도 열 수 있어요.
      </p>
      <div className="row drive-link-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://drive.google.com/…"
          spellCheck={false}
          autoCapitalize="off"
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button type="button" className="primary sm" disabled={!url.trim()} onClick={() => void create()}>
          링크 만들기
        </button>
      </div>
      {msg && <p className={msg.ok ? "drive-link-ok" : "drive-link-error"}>{msg.text}</p>}
    </div>
  );
}

/**
 * The same box as a strip above a real viewer (video player, PDF, slides), for
 * the local-only files that open in one rather than in the file card.
 */
export function LocalOnlyBar({ path }: { path: string }) {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSize(null);
    void ipc
      .fileStat(path, useStore.getState().vault?.epoch)
      .then((s) => {
        if (!cancelled) setSize(s.size);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (size == null || !isLocalOnlyBinary(path, size)) return null;
  return (
    <div className="local-only-bar">
      <DriveLinkPaste path={path} size={size} />
    </div>
  );
}
