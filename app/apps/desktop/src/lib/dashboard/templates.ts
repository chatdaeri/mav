// SPDX-License-Identifier: Apache-2.0
export interface DashboardTemplate {
  id: string;
  name: string;
  category: string;
  palette?: readonly string[];
  description: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  author?: string;
  source?: string;
  html?: string;
  loadHtml?: () => Promise<string>;
  prompt?: string;
}

const loader = (id: string) => async () => {
  const response = await fetch(`/dashboard-templates/${id}.html`);
  if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
  return response.text();
};

/** The only two built-in dashboards. Both read the vault through the SDK and
 *  show sample data in the gallery preview, where no vault bridge exists. */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "mav-overview",
    name: "기본 대시보드",
    author: "마이 세컨드 브레인",
    category: "기본",
    palette: ["#FF7E5F", "#1a1a1a", "#ffffff"],
    description: "노트·파일 수, 최근 편집, 폴더별 노트, 태그, 루틴 상태를 카드로 봐요.",
    source: "마이 세컨드 브레인 · Apache-2.0 · 배치 참고 Tabler(MIT)",
    previewUrl: "/dashboard-templates/mav-overview.html",
    thumbnailUrl: "/dashboard-thumbnails/mav-overview.webp",
    prompt: "이 대시보드를 내 볼트에 맞게 다듬어 줘.",
    loadHtml: loader("mav-overview"),
  },
  {
    id: "mav-graph",
    name: "연결 지도",
    author: "마이 세컨드 브레인",
    category: "기본",
    palette: ["#FF7E5F", "#1a1a1a", "#ffffff"],
    description: "노트 사이 링크를 점과 선으로 보고, 연결 많은 노트와 연결 없는 노트를 찾아요.",
    source: "마이 세컨드 브레인 · Apache-2.0 · 배치 참고 Orbit(Apache-2.0)",
    previewUrl: "/dashboard-templates/mav-graph.html",
    thumbnailUrl: "/dashboard-thumbnails/mav-graph.webp",
    prompt: "이 연결 지도를 내 볼트에 맞게 다듬어 줘.",
    loadHtml: loader("mav-graph"),
  },
];

export function dashboardPrompt(path: string, vaultPath: string, request = "Update this dashboard using my notes."): string {
  return `${request}\n\nDashboard: ${path}\nVault folder: ${vaultPath}\nBaalda renders; it never generates. Read the HTML comment at the top of the file for the optional baalda API. Read relevant Markdown notes or use the 마이 세컨드 브레인 MCP tools; keep those notes as the source of truth, without a separate JSON export. Update this HTML file via filesystem edits or MCP update_note/edit_note, preserving its identity. Only use information I can read and don't invent facts. No fetch/XHR/WebSocket; inline JS or allowed CDNs (cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com). Use /__baalda/sdk.js only when live data is useful; no localStorage. Optional API: vault.info/stats; notes.search/list/read/meta/backlinks; graph.edges; tags.list; properties.keys/values; state.get/set; app.open/openExternal. List filters: folder,tag,property:{key,value},modifiedSince (Unix seconds),sort,limit. Use CSS theme variables --bg,--fg,--surface,--muted,--accent,--border. Write the page the user asked for.`;
}
export async function copyDashboardPrompt(path: string, vaultPath: string, request?: string) {
  await navigator.clipboard.writeText(dashboardPrompt(path, vaultPath, request));
}
