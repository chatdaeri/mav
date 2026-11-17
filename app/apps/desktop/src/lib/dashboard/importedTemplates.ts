// SPDX-License-Identifier: Apache-2.0
// Original upstream dashboards; see public/dashboard-templates/SOURCES.json for revisions and licenses.
export interface DashboardTemplate {
  id: string; name: string; category: string; palette?: readonly string[]; description: string;
  previewUrl?: string; thumbnailUrl?: string; author?: string; source?: string; html?: string; loadHtml?: () => Promise<string>; prompt?: string;
}
const definitions = [
  [
    "tabler",
    "Tabler",
    "Tabler",
    "미니멀",
    [
      "#206bc4",
      "#f6f8fb",
      "#182433"
    ],
    "깔끔한 분석, 차트, 활동 개요"
  ],
  [
    "sneat-html-admin-template-free",
    "Sneat",
    "ThemeSelection",
    "컬러풀",
    [
      "#696cff",
      "#71dd37",
      "#f5f5f9"
    ],
    "둥근 카드와 매출 차트가 있는 부드러운 보라색 분석 화면"
  ],
  [
    "materio-bootstrap-html-admin-template-free",
    "Materio",
    "ThemeSelection",
    "컬러풀",
    [
      "#9055fd",
      "#ffb400",
      "#f4f5fa"
    ],
    "머티리얼 카드, 수익 요약, 다채로운 활동 피드"
  ],
  [
    "argon-dashboard",
    "Argon",
    "Creative Tim",
    "컬러풀",
    [
      "#5e72e4",
      "#2dce89",
      "#f8f9fa"
    ],
    "파란 헤더, 떠 있는 통계, 여유로운 비즈니스 차트"
  ],
  [
    "material-dashboard-v3",
    "Material Dashboard",
    "Creative Tim",
    "미니멀",
    [
      "#e91e63",
      "#343a40",
      "#f0f2f5"
    ],
    "머티리얼 표면, 굵직한 차트 패널, 간결한 지표"
  ],
  [
    "soft-ui-dashboard",
    "Soft UI",
    "Creative Tim",
    "컬러풀",
    [
      "#cb0c9f",
      "#17c1e8",
      "#f8f9fa"
    ],
    "그라데이션 포인트, 부드러운 그림자, 넉넉한 둥근 패널"
  ],
  [
    "black-dashboard",
    "Black Dashboard",
    "Creative Tim",
    "다크",
    [
      "#1e1e2f",
      "#e14eca",
      "#1d8cf8"
    ],
    "어두운 바탕에 네온 성과 차트와 작업 카드"
  ],
  [
    "paper-dashboard",
    "Paper Dashboard",
    "Creative Tim",
    "미니멀",
    [
      "#f4f3ef",
      "#ef8157",
      "#51cbce"
    ],
    "따뜻한 종이 느낌 바탕에 주황·청록 차트"
  ],
  [
    "light-bootstrap-dashboard",
    "Light Bootstrap",
    "Creative Tim",
    "미니멀",
    [
      "#9368e9",
      "#23ccef",
      "#f7f7f8"
    ],
    "가는 테두리와 밝은 차트의 클래식하고 깔끔한 리포트"
  ],
  [
    "now-ui-dashboard",
    "Now UI",
    "Creative Tim & Invision",
    "컬러풀",
    [
      "#f96332",
      "#2ca8ff",
      "#ebecf1"
    ],
    "밝은 코랄색 차트 헤더와 간결한 운영 카드"
  ],
  [
    "startbootstrap-sb-admin",
    "SB Admin",
    "Start Bootstrap",
    "미니멀",
    [
      "#0d6efd",
      "#212529",
      "#ffffff"
    ],
    "직관적인 지표, 차트 비교, 정렬 가능한 데이터"
  ],
  [
    "startbootstrap-sb-admin-2",
    "SB Admin 2",
    "Start Bootstrap",
    "컬러풀",
    [
      "#4e73df",
      "#1cc88a",
      "#f8f9fc"
    ],
    "수익 차트와 프로젝트 진행률이 있는 파란색 비즈니스 개요"
  ],
  [
    "adminkit",
    "AdminKit",
    "AdminKit",
    "미니멀",
    [
      "#3b7ddd",
      "#222e3c",
      "#f5f7fb"
    ],
    "차분한 파란색 통계, 캘린더, 프로젝트 리포트"
  ],
  [
    "PurpleAdmin-Free-Admin-Template",
    "Purple Admin",
    "BootstrapDash",
    "컬러풀",
    [
      "#b66dff",
      "#fe7096",
      "#f2edf3"
    ],
    "파스텔 그라데이션, 매출 차트, 다채로운 작업 개요"
  ],
  [
    "MajesticAdmin-Free-Bootstrap-Admin-Template",
    "Majestic",
    "BootstrapDash",
    "미니멀",
    [
      "#4b49ac",
      "#98bdff",
      "#f5f7ff"
    ],
    "인디고 지표, 방문자, 상세한 성과 표"
  ],
  [
    "StarAdmin-Free-Bootstrap-Admin-Template",
    "Star Admin",
    "BootstrapDash",
    "컬러풀",
    [
      "#2196f3",
      "#ffaf00",
      "#f3f5f7"
    ],
    "청록·호박색 포인트의 촘촘한 운영 리포트"
  ],
  [
    "corona-free-dark-bootstrap-admin-template",
    "Corona",
    "BootstrapDash",
    "다크",
    [
      "#191c24",
      "#00d25b",
      "#0090e7"
    ],
    "고대비 어두운 운영 화면에 밝은 차트와 활동"
  ],
  [
    "AdminLTE",
    "AdminLTE",
    "Colorlib",
    "컬러풀",
    [
      "#0d6efd",
      "#20c997",
      "#f4f6f9"
    ],
    "굵은 색상의 지표 타일, 리포트 차트, 팀 활동"
  ],
  [
    "plainadmin",
    "PlainAdmin",
    "PlainAdmin",
    "미니멀",
    [
      "#365cf5",
      "#ffb800",
      "#f1f5f9"
    ],
    "선명한 파란색 리포트, 깔끔한 표, 캘린더 개요"
  ],
  [
    "mazer",
    "Mazer",
    "Ahmad Saugi",
    "컬러풀",
    [
      "#435ebe",
      "#9694ff",
      "#f2f7ff"
    ],
    "라벤더색 프로필 통계와 여유로운 방문자 차트"
  ]
] as const;
export const IMPORTED_DASHBOARD_TEMPLATES: DashboardTemplate[] = definitions.map(([id, name, author, category, palette, description]) => ({
  id, name, author, category, palette, description,
  source: `원본 가져옴 · ${author}`,
  prompt: `Personalize this original ${name} dashboard from my vault. Read AGENTS.md and the relevant source notes first. Keep the original design and copyright notices, replace sample data with supported facts, remove irrelevant demo components, and connect useful controls. Do not invent metrics.`,
  previewUrl: `/dashboard-templates/${id}.html`,
  thumbnailUrl: `/dashboard-thumbnails/${id}.webp`,
  loadHtml: async () => {
    const response = await fetch(`/dashboard-templates/${id}.html`);
    if (!response.ok) throw new Error("이 템플릿을 사용할 수 없어요. 다른 템플릿을 시도해 보세요.");
    return response.text();
  },
}));
