// SPDX-License-Identifier: Apache-2.0
import type { DashboardTemplate } from "./importedTemplates";

/** User-supplied deployments, bundled with fictional data and local demo actions. */
export const DEPLOYED_OS_TEMPLATES: DashboardTemplate[] = [
  {
    id: "cosmos-agentic-os",
    name: "Cosmos: Agentic OS",
    category: "Agentic OS",
    palette: ["#5ee7ff", "#a78bfa", "#020714"],
    description: "검색, 인스펙터, 브리핑, 레이더, 데모 명령 콘솔을 갖춘 궤도형 지식 그래프. 어두운·밝은 테마.",
    source: "https://benai-cosmos.vercel.app/",
  },
  {
    id: "sales-os",
    name: "Sales OS",
    category: "Agentic OS",
    palette: ["#b4dda8", "#e8c876", "#141815"],
    description: "통화 브리프, 파이프라인 차트, 의사결정, 실행 기록, 맥락, 플레이북, 도구 스택을 갖춘 영업 관제 센터. 어두운·밝은 테마.",
    source: "https://cockpit-nebula-h7q2k.vercel.app/",
  },
  {
    id: "marketing-os",
    name: "Marketing OS",
    category: "Agentic OS",
    palette: ["#3b82f6", "#22c55e", "#0b0c0e"],
    description: "콘텐츠, 캘린더, 캠페인, 퍼널, 성과, 오디언스, 인텔리전스, 팀, 움직이는 시스템 코어를 갖춘 마케팅 작업 공간. 팔레트 6종.",
    source: "https://marketing-os-control.vercel.app/#/intel",
  },
].map((template) => ({
  ...template,
  author: "Ben AI · 마이 세컨드 브레인용으로 변환",
  previewUrl: `/dashboard-templates/${template.id}.html`,
  thumbnailUrl: `/dashboard-thumbnails/${template.id}.webp`,
  prompt: `Personalize ${template.name} using supported facts from my vault. Read the customization comment and sample data first. Preserve the downloaded interface, pages, themes, responsive spacing and motion controls. Replace fictional records with my workflow. Keep simulated actions labeled until deliberately connected; do not invent service connections, execute workflows or send messages from this template. Use 마이 세컨드 브레인's permission-checked dashboard API when live reads are useful. Preserve this HTML file's identity and upstream attribution and dependency notices.`,
  loadHtml: async () => {
    const response = await fetch(`/dashboard-templates/${template.id}.html`);
    if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
    return response.text();
  },
}));
