// Client-held vault keys (W3): the prompts the key session raises, one at a
// time, on the shared ConfirmDialog shell and the app toast. No bespoke styles.
//
// - "Approve this device from your other computer" while linking.
// - "A new device is signing in as you" on an existing device.
// - "<person>'s security key changed": the one human override of a pin.
// - "Gave <person> the vault key" toast with the key's short fingerprint.

import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "../lib/toast";
import { useStore } from "../store";
import { memberDisplayName } from "../lib/vaultKeys/names";
import { currentVaultKeySession, onVaultKeyEvent } from "../lib/vaultKeys/runtime";
import { LOST_DEVICES_LABEL } from "../lib/vaultKeys/recovery";
import { syncManager } from "../lib/sync/docSession";
import { LostDevicesFlow } from "./VaultKeyRecovery";
import type { PendingDeviceView, SealedFor } from "../lib/vaultKeys/session";

type Prompt =
  | { kind: "awaiting-device"; code: string }
  /** "I don't have my other devices", chosen from the awaiting-device prompt. */
  | { kind: "lost-devices" }
  | { kind: "approve-device"; device: PendingDeviceView }
  | { kind: "key-changed"; vaultId: string; change: SealedFor & { publicKey: string } };

const promptKey = (p: Prompt) =>
  p.kind === "approve-device"
    ? `d:${p.device.deviceId}`
    : p.kind === "key-changed"
      ? `k:${p.vaultId}:${p.change.userId}:${p.change.fingerprint}`
      : p.kind === "lost-devices"
        ? "lost"
        : `a:${p.code}`;

const nameOf = (userId: string) => memberDisplayName(useStore.getState().members, userId);

/**
 * "<device> is signing in": one click, Approve or Not me (seamless keys, E).
 * The code is shown read-only so the person can glance at the new computer;
 * nothing is typed. This deliberately replaces the earlier typed-code step
 * (owner decision 2026-11-01): the prompt only ever appears for this
 * account's own pending devices, and the new device keeps showing its code.
 */
export function ApproveDevicePrompt({ device, done }: { device: PendingDeviceView; done: () => void }) {
  const name = device.name?.trim() || "새 컴퓨터";
  return (
    <ConfirmDialog
      title={`${name}에서 로그인하려고 해요`}
      tone="accent"
      confirmLabel="승인"
      cancelLabel="내가 아니에요"
      onConfirm={async () => {
        const ok = await currentVaultKeySession()?.approveDevice(device, device.code);
        toast(ok ? "컴퓨터를 승인했어요." : "컴퓨터를 승인하지 못했어요. 아무것도 승인되지 않았어요.", ok ? "success" : "error");
        done();
      }}
      onCancel={() => {
        void currentVaultKeySession()?.denyDevice(device.deviceId);
        done();
      }}
    >
      <p>
        다른 컴퓨터에서 마이 세컨드 브레인을 설정하는 중이라면 승인하세요. 그 컴퓨터에는 코드{" "}
        <strong aria-label="새 컴퓨터에 표시된 코드">{device.code}</strong>가 표시돼요. 본인이 아니라면
        '내가 아니에요'를 선택하세요.
      </p>
    </ConfirmDialog>
  );
}

export function VaultKeyPrompts() {
  const [queue, setQueue] = useState<Prompt[]>([]);
  useStore((s) => s.members); // re-render when the roster arrives
  const isOwner = useStore((s) => s.members.find((m) => m.userId === s.session?.user.id)?.role === "owner");

  useEffect(() => {
    const seen = new Set<string>();
    const push = (p: Prompt) => {
      const key = promptKey(p);
      if (seen.has(key)) return;
      seen.add(key);
      setQueue((q) => [...q, p]);
    };
    return onVaultKeyEvent((e) => {
      if (e.kind === "account" && e.state.state === "awaiting-device-approval") {
        push({ kind: "awaiting-device", code: e.state.code });
      } else if (e.kind === "account" && e.state.state === "security-warning") {
        toast("서버에 있는 보안 키가 이 컴퓨터와 일치하지 않아요. 볼트 키 사용이 일시 중지됐어요.", "error");
      } else if (e.kind === "rate-limited") {
        toast(e.message, "error");
      } else if (e.kind === "pending-devices") {
        for (const device of e.devices) push({ kind: "approve-device", device });
      } else if (e.kind === "serviced") {
        for (const s of e.result.sealed) {
          toast(`${e.names?.[s.userId] ?? nameOf(s.userId)}님에게 볼트 키를 전달했어요 · ${s.fingerprint}`);
        }
        for (const change of e.result.keyChanged) push({ kind: "key-changed", vaultId: e.vaultId, change });
      }
    });
  }, []);

  const current = queue[0];
  const done = () => setQueue((q) => q.slice(1));
  /** Swap the head prompt for another (the lost-devices path). */
  const replaceHead = (p: Prompt) => setQueue((q) => [p, ...q.slice(1)]);
  if (!current) return null;

  switch (current.kind) {
    case "awaiting-device":
      return (
        <ConfirmDialog
          title="이 컴퓨터 승인"
          tone="accent"
          confirmLabel="확인"
          cancelLabel="닫기"
          onConfirm={done}
          onCancel={done}
        >
          <p>
            이미 로그인한 컴퓨터에서 마이 세컨드 브레인을 열고 이 컴퓨터를 승인하세요. 같은 코드가 표시되는지
            확인하세요: <strong>{current.code}</strong>
          </p>
          <p>
            <button type="button" className="link-btn" onClick={() => replaceHead({ kind: "lost-devices" })}>
              {LOST_DEVICES_LABEL}
            </button>
          </p>
        </ConfirmDialog>
      );
    case "lost-devices":
      return <LostDevicesFlow isOwner={isOwner} vaultId={syncManager.registry.vaultId} onClose={done} />;
    case "approve-device":
      return <ApproveDevicePrompt key={current.device.deviceId} device={current.device} done={done} />;
    case "key-changed":
      return (
        <ConfirmDialog
          title={`${nameOf(current.change.userId)}님의 보안 키가 바뀌었어요`}
          tone="danger"
          confirmLabel="승인"
          cancelLabel="나중에"
          onConfirm={async () => {
            const ok = await currentVaultKeySession()?.approveChangedKey(current.vaultId, current.change);
            toast(ok ? "새 보안 키를 승인했어요." : "보안 키를 승인하지 못했어요.", ok ? "success" : "error");
            done();
          }}
          onCancel={done}
        >
          <p>
            상대방의 코드가 <strong>{current.change.fingerprint}</strong>(으)로 바뀌었어요. 상대방에게 직접
            이 코드를 확인한 경우에만 승인하세요.
          </p>
        </ConfirmDialog>
      );
  }
}
