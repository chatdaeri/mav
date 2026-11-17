// SPDX-License-Identifier: Apache-2.0
import { IMPORTED_DASHBOARD_TEMPLATES, type DashboardTemplate } from "./importedTemplates";
import { DEPLOYED_OS_TEMPLATES } from "./deployedTemplates";
export type { DashboardTemplate } from "./importedTemplates";
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [{
  id: "orbit-agentic-os",
  name: "Orbit: Agentic OS",
  author: "마이 세컨드 브레인",
  category: "Agentic OS",
  palette: ["#83e4ee", "#b6a4f7", "#080d13"],
  description: "미션, 스킬, 메모리, 신호, 활동을 담은 움직이는 커맨드 센터. 어두운·밝은 테마 포함.",
  source: "마이 세컨드 브레인 오리지널 · Apache-2.0",
  previewUrl: "/dashboard-templates/orbit-agentic-os.html",
  thumbnailUrl: "/dashboard-thumbnails/orbit-agentic-os.webp",
  prompt: "Personalize Orbit, my Agentic OS dashboard, using the relevant notes in my vault. Read the customization comment and DEMO data first. Keep its dark and light themes, responsive pages, animated core and reduced-motion support. Replace sample metrics, missions, skills, memory and reports with supported facts; keep anything still simulated clearly labeled. Use 마이 세컨드 브레인's existing permission-checked dashboard API for live reads. Do not invent agent connections or execute workflows from the template. Preserve this HTML file's identity and the bundled font license notices.",
  loadHtml: async () => {
    const response = await fetch("/dashboard-templates/orbit-agentic-os.html");
    if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
    return response.text();
  },
}, {
  id: "waystation-agentic-os",
  name: "Waystation: Agentic OS",
  author: "마이 세컨드 브레인",
  category: "Agentic OS",
  palette: ["#8edec1", "#f3c77e", "#10191d"],
  description: "스테이션 여섯 곳, 작업 대기열, 루틴, 결과물 보관함을 갖춘 움직이는 아이소메트릭 에이전트 스튜디오. 밤·낮 테마 포함.",
  source: "마이 세컨드 브레인 오리지널 · Apache-2.0",
  previewUrl: "/dashboard-templates/waystation-agentic-os.html",
  thumbnailUrl: "/dashboard-thumbnails/waystation-agentic-os.webp",
  prompt: "Personalize Waystation using supported facts from my vault. Read the customization comment and DEMO data. Preserve the isometric room, selectable stations, night/day themes, responsive layout and reduced-motion support. Replace sample agents, tasks, routines and artifacts with my workflow. Keep simulations labeled; do not invent connections or execute tasks from this HTML. Use 마이 세컨드 브레인's permission-checked API for live reads. Preserve file identity and font license notices.",
  loadHtml: async () => {
    const response = await fetch("/dashboard-templates/waystation-agentic-os.html");
    if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
    return response.text();
  },
}, {
  id: "meridian-agentic-os",
  name: "Meridian: Agentic OS",
  author: "마이 세컨드 브레인",
  category: "Agentic OS",
  palette: ["#c4aff7", "#e5aac7", "#17131e"],
  description: "앱, 루틴, 메모리, 스킬을 한눈에 보는 개인 관측소. 결과물 아틀라스, 캘린더, 받은 편지함 포함. 어두운·밝은 테마 포함.",
  source: "마이 세컨드 브레인 오리지널 · Apache-2.0",
  previewUrl: "/dashboard-templates/meridian-agentic-os.html",
  thumbnailUrl: "/dashboard-thumbnails/meridian-agentic-os.webp",
  prompt: "Personalize Meridian using supported facts from my vault. Read its customization comment and DEMO data. Keep the artifact atlas, searchable library, memory map, dark/light themes and reduced-motion support. Adapt the apps, routines, calendar, inbox and skill playbooks to my work. Keep demo data and simulated runs labeled until replaced; never invent agent connections or schedules. Use 마이 세컨드 브레인's existing permission-checked API for live reads. Preserve this HTML file's identity and font license notices.",
  loadHtml: async () => {
    const response = await fetch("/dashboard-templates/meridian-agentic-os.html");
    if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
    return response.text();
  },
}, ...DEPLOYED_OS_TEMPLATES, ...IMPORTED_DASHBOARD_TEMPLATES];

export function dashboardPrompt(path: string, vaultPath: string, request = "Update this dashboard using my notes."): string {
  return `${request}\n\nDashboard: ${path}\nVault folder: ${vaultPath}\nBaalda renders; it never generates. Read the HTML comment at the top of the file for the optional baalda API. Read relevant Markdown notes or use the 마이 세컨드 브레인 MCP tools; keep those notes as the source of truth, without a separate JSON export. Update this HTML file via filesystem edits or MCP update_note/edit_note, preserving its identity. Only use information I can read and don't invent facts. No fetch/XHR/WebSocket; inline JS or allowed CDNs (cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com). Use /__baalda/sdk.js only when live data is useful; no localStorage. Optional API: vault.info/stats; notes.search/list/read/meta/backlinks; graph.edges; tags.list; properties.keys/values; state.get/set; app.open/openExternal. List filters: folder,tag,property:{key,value},modifiedSince (Unix seconds),sort,limit. Use CSS theme variables --bg,--fg,--surface,--muted,--accent,--border. Write the page the user asked for.`;
}
export async function copyDashboardPrompt(path: string, vaultPath: string, request?: string) {
  await navigator.clipboard.writeText(dashboardPrompt(path, vaultPath, request));
}
