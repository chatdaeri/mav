// SPDX-License-Identifier: Apache-2.0

export const DASHBOARD_PROTOCOL = "baalda.dashboard.v1";
export type DashboardRequest = { channel: typeof DASHBOARD_PROTOCOL; id: string; method: string; params?: unknown };
export type DashboardReply = { channel: typeof DASHBOARD_PROTOCOL; id: string; result?: unknown; error?: string };
export type DashboardMethods = Record<string, (params: unknown) => unknown | Promise<unknown>>;

/** Opaque origins all report null: only the mounted frame is an authority. */
export function createDashboardBridge(options: {
  source: () => unknown;
  current: () => boolean;
  methods: DashboardMethods;
  reply: (message: DashboardReply) => void;
}) {
  let active = 0;
  let disposed = false;
  return {
    dispose() { disposed = true; },
    async handle(event: { source: unknown; origin: string; data: unknown }): Promise<void> {
      const source = options.source();
      if (!source || disposed || !options.current() || event.source !== source || event.origin !== "null") return;
      const data = event.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      const request = data as DashboardRequest;
      if (request.channel !== DASHBOARD_PROTOCOL || typeof request.id !== "string" || !request.id || request.id.length > 100 || typeof request.method !== "string" || request.method.length > 100) return;
      const reply: DashboardReply = { channel: DASHBOARD_PROTOCOL, id: request.id };
      if (active >= 20) reply.error = "대기 중인 요청이 너무 많아요";
      else {
        active++;
        try {
          if (JSON.stringify(request.params ?? null).length > 64 * 1024) throw new Error("요청이 너무 커요");
          if (!Object.prototype.hasOwnProperty.call(options.methods, request.method)) throw new Error("알 수 없는 대시보드 메서드예요");
          reply.result = await options.methods[request.method](request.params);
          if (JSON.stringify(reply.result ?? null).length > 10 * 1024 * 1024) throw new Error("응답이 너무 커요");
        } catch (error) {
          reply.error = error instanceof Error ? error.message : "대시보드 요청에 실패했어요";
          delete reply.result;
        } finally { active--; }
      }
      if (!disposed && options.current() && options.source() === source) options.reply(reply);
    },
  };
}

export function dashboardPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096 || value.includes("\\") || value.includes(":") || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("노트 경로가 올바르지 않아요");
  const denied = ["node_modules", "dist", "build", "target", "vendor", "__pycache__", "venv"];
  if (value.startsWith("/") || value.split("/").some((part) => !part || part.startsWith(".") || denied.includes(part))) throw new Error("노트 경로가 올바르지 않아요");
  if (!/\.(md|markdown|mdx|txt|html|htm|canvas|url|webloc)$/i.test(value)) throw new Error("노트 경로가 필요해요");
  return value;
}

export function dashboardExternalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("외부 URL이 올바르지 않아요");
  const url = new URL(value);
  if (!["https:", "mailto:"].includes(url.protocol) || url.username || url.password) throw new Error("HTTPS와 mailto 링크만 사용할 수 있어요");
  return url.href;
}

export function dashboardUrl(path: string, epoch: number, platform: string): string {
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("Invalid vault epoch");
  const origin = platform === "windows" ? "http://baalda-view.localhost" : "baalda-view://localhost";
  return `${origin}/__baalda/vault/${epoch}/${dashboardPath(path).split("/").map(encodeURIComponent).join("/")}`;
}
