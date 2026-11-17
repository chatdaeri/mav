// Small helpers for the skills screens' loading states. Pure, pinned by
// `__tests__/loading.test.ts`.

export const LOAD_TIMEOUT_MS = 30_000;

export class LoadTimeoutError extends Error {
  constructor(message = "시간이 너무 오래 걸려요. 연결을 확인한 뒤 다시 시도하세요.") {
    super(message);
    this.name = "LoadTimeoutError";
  }
}

/**
 * `promise`, or a LoadTimeoutError after `ms`: a request that hangs ends in the
 * page's error state with Try again, never a skeleton that never leaves.
 */
export function withTimeout<T>(promise: Promise<T>, ms = LOAD_TIMEOUT_MS, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LoadTimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A failure's text for an inline error line. */
export function loadErrorText(e: unknown): string {
  if (e instanceof LoadTimeoutError) return e.message;
  const text = e instanceof Error ? e.message : String(e);
  return text || "문제가 생겼어요.";
}
