// "I lost every device": the dialogs on the shared ConfirmDialog shell, raised
// from the approve-this-computer prompt and the waiting notice. Pure logic and
// copy live in `lib/vaultKeys/recovery.ts`. Nothing here deletes local files or
// touches a vault key this computer already holds.

import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { toast } from "../lib/toast";
import { currentVaultKeySession, startFreshAccountKey, vaultKeysNudge } from "../lib/vaultKeys/runtime";
import {
  FRESH_KEY_EXPLAINER,
  FRESH_KEY_WAITING_PREFIX,
  RESTORE_INSTEAD_LABEL,
  lostDevicesStep,
  offersRestoreInstead,
  type LostDevicesStep,
} from "../lib/vaultKeys/recovery";

/** The owner's 24-word restore for one vault. */
export function RestoreVaultKeyDialog({ vaultId, onClose }: { vaultId: string; onClose: () => void }) {
  const [words, setWords] = useState("");
  return (
    <ConfirmDialog
      title="볼트 키로 복원"
      tone="accent"
      confirmLabel="복원"
      confirmDisabled={!words.trim()}
      onCancel={onClose}
      onConfirm={async () => {
        const result = await currentVaultKeySession()?.restoreWithVaultKey(vaultId, words);
        if (result === "restored") {
          toast("이 컴퓨터에 볼트 키를 복원했어요.");
          setWords("");
          onClose();
          vaultKeysNudge();
        } else {
          toast(
            result === "wrong-key"
              ? "이 키는 이 볼트의 키가 아니에요. 아무것도 바뀌지 않았어요."
              : result === "invalid-words"
                ? "올바른 키 단어 24개가 아니에요. 각 단어를 확인하세요."
                : "지금은 키를 확인할 수 없어요. 나중에 다시 시도하세요.",
            "error",
          );
        }
      }}
    >
      <p>이 볼트 키의 단어 24개를 붙여넣으세요.</p>
      <textarea
        value={words}
        rows={3}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setWords(e.target.value)}
      />
    </ConfirmDialog>
  );
}

/** The fresh-key wait: the code teammates must confirm. */
export function FreshKeyWaitingDialog({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <ConfirmDialog title="새 보안 키를 만들었어요" tone="accent" confirmLabel="확인" cancelLabel="닫기" onConfirm={onClose} onCancel={onClose}>
      <p>
        {FRESH_KEY_WAITING_PREFIX} <strong>{code}</strong>
      </p>
    </ConfirmDialog>
  );
}

/**
 * "I don't have my other devices": confirm → `startFreshAccountKey` → the
 * waiting dialog with the new code. Owners may restore with the vault key
 * instead. A refusal (rate limited: the runtime toasts the server's message)
 * or an error changes nothing and closes.
 */
export function LostDevicesFlow({
  isOwner,
  vaultId,
  onClose,
}: {
  isOwner: boolean;
  vaultId: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<LostDevicesStep>({ step: "confirm" });
  const close = () => {
    setStep((s) => lostDevicesStep(s, { type: "cancel" }));
    onClose();
  };

  if (step.step === "restore" && vaultId) return <RestoreVaultKeyDialog vaultId={vaultId} onClose={close} />;
  if (step.step === "waiting") return <FreshKeyWaitingDialog code={step.code} onClose={close} />;
  if (step.step !== "confirm") return null;

  return (
    <ConfirmDialog
      title="새 보안 키 만들기"
      tone="accent"
      confirmLabel="새 키 만들기"
      onCancel={close}
      onConfirm={async () => {
        let next: LostDevicesStep;
        try {
          const result = await startFreshAccountKey();
          if (result.kind === "started") {
            next = lostDevicesStep(step, { type: "started", code: result.code });
          } else {
            if (result.kind === "not-allowed") {
              toast("이 컴퓨터에는 이미 보안 키가 있거나 키 기능이 꺼져 있어요. 아무것도 바뀌지 않았어요.", "error");
            }
            next = lostDevicesStep(step, { type: "refused" });
          }
        } catch {
          toast("지금은 새 보안 키를 만들 수 없어요. 아무것도 바뀌지 않았어요. 나중에 다시 시도하세요.", "error");
          next = lostDevicesStep(step, { type: "refused" });
        }
        if (next.step === "closed") onClose();
        setStep(next);
      }}
    >
      <p>{FRESH_KEY_EXPLAINER}</p>
      {offersRestoreInstead({ isOwner, vaultId }) && (
        <p>
          <button type="button" className="link-btn" onClick={() => setStep((s) => lostDevicesStep(s, { type: "restore" }))}>
            {RESTORE_INSTEAD_LABEL}
          </button>
        </p>
      )}
    </ConfirmDialog>
  );
}
